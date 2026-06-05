import postgres from "postgres";
import { getAdminUser } from "~/server/utils/utils";

export const dynamic = "force-dynamic";

// Raw-SQL console backend for PLATFORM_ADMINs (paired with the /database/console
// page). Deliberately separate from /api/studio (the Prisma Studio embed, which
// must stay read/write for its cell-edits).
//
// Execution model — the whole request runs in ONE transaction:
//   • read           — SET TRANSACTION READ ONLY; a fat-fingered UPDATE errors at
//                      the database, not via a bypassable keyword blocklist.
//   • write dry run  — run, then ROLLBACK. Reports the real would-be affected-row
//     (commit:false)   counts (+ any RETURNING rows) WITHOUT saving. Default.
//   • write commit   — run and COMMIT. Nothing persists unless commit === true.
//     (commit:true)
//
// Multiple `;`-separated statements run in order in that single transaction and
// each gets its own result; the first statement error rolls the whole batch back
// (so a multi-statement write is all-or-nothing). Rows come back POSITIONALLY
// (value-arrays aligned to `columns`) via postgres.js `.values()` rather than as
// objects, which preserves duplicate column names from joins.
//
// Caveat: a dry run and its commit execute the batch twice (once rolled back,
// once for real), so the committed counts are authoritative. We deliberately do
// NOT hold a transaction open across requests (that would keep locks held during
// admin "think time").

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

// True when `stmt` carries no SQL once comments and whitespace are stripped.
function isBlank(stmt: string): boolean {
	const noComments = stmt
		.replace(/--[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	return noComments.trim().length === 0;
}

// Split a SQL script into individual statements on TOP-LEVEL semicolons, leaving
// semicolons inside '…'/"…" quotes, -- line comments, /* … */ (nestable) block
// comments, and $tag$…$tag$ dollar-quotes untouched. Comment-only segments are
// dropped. This lets the console run a multi-statement script and show a grid per
// statement, rather than relying on the driver (which returns only the last
// result for a multi-statement query).
function splitStatements(input: string): string[] {
	const out: string[] = [];
	let buf = "";
	let i = 0;
	const n = input.length;
	while (i < n) {
		const ch = input[i];
		const next = input[i + 1];
		if (ch === "-" && next === "-") {
			const nl = input.indexOf("\n", i);
			const stop = nl === -1 ? n : nl;
			buf += input.slice(i, stop);
			i = stop;
		} else if (ch === "/" && next === "*") {
			let depth = 1;
			let j = i + 2;
			while (j < n && depth > 0) {
				if (input[j] === "/" && input[j + 1] === "*") {
					depth++;
					j += 2;
				} else if (input[j] === "*" && input[j + 1] === "/") {
					depth--;
					j += 2;
				} else j++;
			}
			buf += input.slice(i, j);
			i = j;
		} else if (ch === "'" || ch === '"') {
			let j = i + 1;
			while (j < n) {
				if (input[j] === ch) {
					if (input[j + 1] === ch) {
						j += 2; // escaped quote ('' or "")
						continue;
					}
					j++;
					break;
				}
				j++;
			}
			buf += input.slice(i, j);
			i = j;
		} else if (ch === "$") {
			const tag = /^\$[A-Za-z0-9_]*\$/.exec(input.slice(i))?.[0];
			if (tag) {
				const close = input.indexOf(tag, i + tag.length);
				const stop = close === -1 ? n : close + tag.length;
				buf += input.slice(i, stop);
				i = stop;
			} else {
				buf += ch;
				i++;
			}
		} else if (ch === ";") {
			if (!isBlank(buf)) out.push(buf.trim());
			buf = "";
			i++;
		} else {
			buf += ch;
			i++;
		}
	}
	if (!isBlank(buf)) out.push(buf.trim());
	return out;
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

	const statements = splitStatements(sqlText);
	if (statements.length === 0) {
		return Response.json({ error: "No SQL statement found." }, { status: 400 });
	}

	const url = process.env.DATABASE_URL;
	if (!url) {
		return Response.json(
			{ error: "DATABASE_URL is not configured" },
			{ status: 500 },
		);
	}

	type StmtResult =
		| {
				ok: true;
				sql: string;
				columns: string[];
				rows: unknown[][];
				rowCount: number;
				truncated: boolean;
		  }
		| { ok: false; sql: string; error: string };

	const actor = admin.user.email ?? admin.user.userId;
	const timeout = mode === "read" ? READ_TIMEOUT : WRITE_TIMEOUT;
	const results: StmtResult[] = [];
	const sql = postgres(url, { max: 1 });
	try {
		const ROLLBACK = Symbol("db-console-preview-rollback");
		try {
			await sql.begin(async (tx) => {
				if (mode === "read") await tx.unsafe("SET TRANSACTION READ ONLY");
				await tx.unsafe(`SET LOCAL statement_timeout = '${timeout}'`);
				for (const stmt of statements) {
					const res = await tx.unsafe(stmt).values();
					const all = Array.from(res) as unknown[][];
					const truncated = all.length > MAX_ROWS;
					results.push({
						ok: true,
						sql: stmt,
						columns: res.columns?.map((c) => c.name) ?? [],
						rows: truncated ? all.slice(0, MAX_ROWS) : all,
						rowCount: res.count,
						truncated,
					});
				}
				// Dry run (write preview): discard the whole batch.
				if (mode === "write" && !commit) throw ROLLBACK;
			});
		} catch (e) {
			if (e !== ROLLBACK) {
				// A statement (or the connection) errored; the transaction rolled
				// back. `results` holds the statements that ran before it.
				results.push({
					ok: false,
					sql: statements[results.length] ?? "",
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}

		const batchFailed = results.some((r) => !r.ok);
		const persisted = mode === "write" && commit && !batchFailed;
		const phase =
			mode === "read"
				? "read"
				: persisted
					? "write-commit"
					: batchFailed
						? "write-error"
						: "write-preview";
		const totalRows = results.reduce((s, r) => s + (r.ok ? r.rowCount : 0), 0);
		const auditLine = `[db-console] actor=${actor} phase=${phase} statements=${statements.length} rows=${totalRows} sql=${JSON.stringify(sqlText)}`;
		if (mode === "write" && commit) console.warn(auditLine);
		else console.info(auditLine);

		return Response.json({
			ok: true,
			mode,
			persisted,
			statements: results.map((r) =>
				r.ok
					? {
							ok: true,
							sql: r.sql,
							columns: r.columns,
							rows: toJsonSafe(r.rows),
							rowCount: r.rowCount,
							truncated: r.truncated,
						}
					: { ok: false, sql: r.sql, error: r.error },
			),
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
