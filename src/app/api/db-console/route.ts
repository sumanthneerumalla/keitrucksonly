import postgres from "postgres";
import { getAdminUser } from "~/server/utils/utils";

export const dynamic = "force-dynamic";

// Raw-SQL console backend for PLATFORM_ADMINs (paired with the /database/console
// page). Deliberately separate from /api/studio (the Prisma Studio embed, which
// must stay read/write for its cell-edits).
//
// Three execution phases, all wrapped in a transaction:
//   • read             — SET TRANSACTION READ ONLY; a fat-fingered UPDATE errors
//                        at the database, not via a bypassable keyword blocklist.
//   • write dry run    — run the statement, then ROLLBACK. Reports the real
//     (commit:false)     would-be affected-row count (+ any RETURNING rows)
//                        WITHOUT saving. This is the default for write mode.
//   • write commit     — run the statement and COMMIT. Nothing persists unless
//     (commit:true)      the caller explicitly opts in, so writes are
//                        preview-by-default.
//
// Caveat: a dry run and its commit execute the statement twice (once rolled back,
// once for real), so the committed row count is authoritative — the data could
// shift between the two. We deliberately do NOT hold a transaction open across
// requests, which would keep row locks held during admin "think time".

const MAX_ROWS = 1000;
const READ_TIMEOUT = "8s";
const WRITE_TIMEOUT = "15s";

type Mode = "read" | "write";

function getErrorStatus(
	error: "Unauthorized" | "NotOnboarded" | "Forbidden",
): number {
	return error === "Forbidden" ? 403 : 401;
}

// Postgres rows can hold values JSON.stringify rejects (bigint) or mangles
// (Buffer/bytea). Normalize to JSON-safe primitives before Response.json.
function toJsonSafe(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (_key, v) => {
			if (typeof v === "bigint") return v.toString();
			if (v instanceof Date) return v.toISOString();
			if (v instanceof Buffer) return `\\x${v.toString("hex")}`;
			return v;
		}),
	);
}

export async function POST(request: Request): Promise<Response> {
	const admin = await getAdminUser();
	if (!admin.success) {
		return Response.json(
			{ error: admin.error },
			{ status: getErrorStatus(admin.error) },
		);
	}

	let sqlText: string;
	let mode: Mode;
	let commit = false;
	try {
		const body = await request.json();
		sqlText = typeof body.sql === "string" ? body.sql.trim() : "";
		// Read unless the caller explicitly asks for write — safe by default.
		mode = body.mode === "write" ? "write" : "read";
		// Writes are preview-by-default: nothing persists unless commit === true.
		commit = mode === "write" && body.commit === true;
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (!sqlText) {
		return Response.json({ error: "sql is required" }, { status: 400 });
	}

	const url = process.env.DATABASE_URL;
	if (!url) {
		return Response.json(
			{ error: "DATABASE_URL is not configured" },
			{ status: 500 },
		);
	}

	const actor = admin.user.email ?? admin.user.userId;
	const timeout = mode === "read" ? READ_TIMEOUT : WRITE_TIMEOUT;
	const sql = postgres(url, { max: 1 });
	try {
		let captured: {
			rows: Record<string, unknown>[];
			count: number;
			columns: string[];
		};

		if (mode === "write" && !commit) {
			// DRY RUN: execute the write, capture the result, then force a ROLLBACK
			// by throwing a sentinel so nothing persists — we only report what the
			// statement *would* do.
			const ROLLBACK = Symbol("db-console-preview-rollback");
			let preview: typeof captured | undefined;
			try {
				await sql.begin(async (tx) => {
					await tx.unsafe(`SET LOCAL statement_timeout = '${timeout}'`);
					const res = await tx.unsafe(sqlText);
					preview = {
						rows: Array.from(res) as Record<string, unknown>[],
						count: res.count,
						columns: res.columns?.map((c) => c.name) ?? [],
					};
					throw ROLLBACK;
				});
			} catch (e) {
				if (e !== ROLLBACK) throw e;
			}
			captured = preview ?? { rows: [], count: 0, columns: [] };
		} else {
			// READ (read-only tx) or committed WRITE (begin commits on success).
			captured = await sql.begin(async (tx) => {
				if (mode === "read") await tx.unsafe("SET TRANSACTION READ ONLY");
				await tx.unsafe(`SET LOCAL statement_timeout = '${timeout}'`);
				const res = await tx.unsafe(sqlText);
				return {
					rows: Array.from(res) as Record<string, unknown>[],
					count: res.count,
					columns: res.columns?.map((c) => c.name) ?? [],
				};
			});
		}

		const persisted = mode === "write" && commit;
		const truncated = captured.rows.length > MAX_ROWS;
		const rows = truncated ? captured.rows.slice(0, MAX_ROWS) : captured.rows;

		const phase =
			mode === "read" ? "read" : persisted ? "write-commit" : "write-preview";
		const auditLine = `[db-console] actor=${actor} phase=${phase} rows=${captured.count} sql=${JSON.stringify(sqlText)}`;
		if (persisted) console.warn(auditLine);
		else console.info(auditLine);

		return Response.json({
			ok: true,
			mode,
			persisted,
			rowCount: captured.count,
			columns: captured.columns,
			rows: toJsonSafe(rows),
			truncated,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(
			`[db-console] actor=${actor} mode=${mode} ERROR=${JSON.stringify(message)} sql=${JSON.stringify(sqlText)}`,
		);
		return Response.json({ error: message }, { status: 400 });
	} finally {
		await sql.end();
	}
}
