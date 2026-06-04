"use client";

import { useState } from "react";
import { Button } from "~/app/_components/shared/Button";

type Mode = "read" | "write";

interface RunResult {
	ok?: boolean;
	mode?: Mode;
	persisted?: boolean;
	rowCount?: number;
	columns?: string[];
	rows?: unknown[][];
	truncated?: boolean;
	error?: string;
}

function formatCell(value: unknown): string {
	if (value === null || value === undefined) return "∅";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

export default function SqlConsole() {
	const [sql, setSql] = useState("");
	const [mode, setMode] = useState<Mode>("read");
	const [ackWrite, setAckWrite] = useState(false);
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<RunResult | null>(null);
	const [copied, setCopied] = useState(false);
	// The exact SQL text of the last successful dry run. The Commit button only
	// shows while this still matches the textarea — editing the query invalidates
	// the preview so you can never commit something other than what you previewed.
	const [previewSql, setPreviewSql] = useState<string | null>(null);

	const canRun =
		sql.trim().length > 0 && !loading && (mode === "read" || ackWrite);
	const hasValidPreview =
		mode === "write" &&
		previewSql === sql &&
		result?.ok === true &&
		result?.persisted === false;

	function selectMode(next: Mode) {
		setMode(next);
		setPreviewSql(null);
		if (next === "read") setAckWrite(false);
	}

	function discard() {
		setResult(null);
		setPreviewSql(null);
	}

	async function copyResults() {
		if (!result?.rows || !result.columns) return;
		const cols = result.columns;
		// Rebuild row objects (column names × positional values) so the copied JSON
		// is the familiar array-of-objects shape for pasting into issues/debugging.
		const objects = result.rows.map((row) =>
			Object.fromEntries(cols.map((c, i) => [c, row[i]])),
		);
		try {
			await navigator.clipboard.writeText(JSON.stringify(objects, null, 2));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard can be unavailable (non-secure context) — ignore silently.
		}
	}

	async function run(commit: boolean) {
		if (loading) return;
		if (!commit && !canRun) return;
		setLoading(true);
		if (!commit) setResult(null);
		try {
			const res = await fetch("/api/db-console", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sql, mode, commit }),
			});
			const data = (await res.json()) as RunResult;
			setResult(data);
			// Remember the dry run so its Commit button stays bound to this exact SQL.
			setPreviewSql(mode === "write" && !commit && data.ok ? sql : null);
		} catch (err) {
			setResult({ error: err instanceof Error ? err.message : String(err) });
			setPreviewSql(null);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex h-full flex-col gap-4 p-6">
			<div>
				<h1 className="font-semibold text-xl">SQL Console</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					Read-only by default. In write mode, Preview runs your statement and
					rolls it back so you can see what it would change before committing.
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<div className="inline-flex overflow-hidden rounded-md border border-gray-300">
					<button
						type="button"
						onClick={() => selectMode("read")}
						className={
							mode === "read"
								? "bg-[var(--primary)] px-3 py-1.5 text-sm text-white"
								: "bg-white px-3 py-1.5 text-gray-700 text-sm"
						}
					>
						Read-only
					</button>
					<button
						type="button"
						onClick={() => selectMode("write")}
						className={
							mode === "write"
								? "bg-red-600 px-3 py-1.5 text-sm text-white"
								: "bg-white px-3 py-1.5 text-gray-700 text-sm"
						}
					>
						Write
					</button>
				</div>
				<span className="text-gray-500 text-xs">
					{mode === "read"
						? "Writes are rejected by the database (READ ONLY transaction)."
						: "Write mode previews first; nothing is saved until you commit."}
				</span>
			</div>

			<textarea
				value={sql}
				onChange={(e) => setSql(e.target.value)}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(false);
				}}
				placeholder={'SELECT * FROM "User" LIMIT 50;'}
				spellCheck={false}
				className="h-40 w-full resize-y rounded-md border border-gray-300 p-3 font-mono text-sm"
			/>

			{mode === "write" && (
				<label className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800 text-sm">
					<input
						type="checkbox"
						checked={ackWrite}
						onChange={(e) => setAckWrite(e.target.checked)}
					/>
					I understand this query can modify or delete data.
				</label>
			)}

			<div className="flex flex-wrap items-center gap-3">
				{mode === "read" && (
					<Button onClick={() => run(false)} disabled={!canRun}>
						{loading ? "Running…" : "Run"}
					</Button>
				)}
				{mode === "write" && !hasValidPreview && (
					<Button onClick={() => run(false)} disabled={!canRun}>
						{loading ? "Previewing…" : "Preview write"}
					</Button>
				)}
				{mode === "write" && hasValidPreview && (
					<>
						<Button
							variant="destructive"
							onClick={() => run(true)}
							disabled={loading}
						>
							{loading
								? "Committing…"
								: `Commit ${result?.rowCount ?? 0} change(s)`}
						</Button>
						<Button variant="outline" onClick={discard} disabled={loading}>
							Discard
						</Button>
					</>
				)}
				<span className="text-gray-400 text-xs">⌘/Ctrl + Enter to run</span>
			</div>

			{result?.error && (
				<div className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-3 font-mono text-red-800 text-sm">
					{result.error}
				</div>
			)}

			{result?.ok && (
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-gray-200">
					<div
						className={
							result.mode === "write" && result.persisted
								? "flex items-center justify-between gap-2 border-green-200 border-b bg-green-50 px-3 py-2 text-green-800 text-xs"
								: result.mode === "write"
									? "flex items-center justify-between gap-2 border-amber-200 border-b bg-amber-50 px-3 py-2 text-amber-800 text-xs"
									: "flex items-center justify-between gap-2 border-gray-200 border-b bg-gray-50 px-3 py-2 text-gray-600 text-xs"
						}
					>
						<span>
							{result.mode === "write" && result.persisted
								? `Committed — ${result.rowCount} row(s) changed.`
								: result.mode === "write"
									? `Dry run — would affect ${result.rowCount} row(s). Rolled back, nothing saved.`
									: `${result.rowCount} row(s)`}
							{result.truncated
								? ` · showing first ${result.rows?.length}`
								: ""}
						</span>
						{result.rows && result.rows.length > 0 && (
							<button
								type="button"
								onClick={copyResults}
								className="shrink-0 rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
							>
								{copied ? "Copied!" : "Copy JSON"}
							</button>
						)}
					</div>
					<div className="min-h-0 flex-1 overflow-auto">
						{result.rows && result.rows.length > 0 && result.columns ? (
							<table className="w-full border-collapse text-left text-sm">
								<thead className="sticky top-0 bg-gray-100">
									<tr>
										{result.columns.map((c, ci) => (
											<th
												// biome-ignore lint/suspicious/noArrayIndexKey: SQL can return duplicate column names; column position is the stable identity
												key={ci}
												className="border-gray-200 border-b px-3 py-2 font-medium"
											>
												{c}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{result.rows.map((row, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: result rows are a static, fully-replaced snapshot — index is stable and unique
										<tr key={i} className="odd:bg-white even:bg-gray-50">
											{row.map((cell, ci) => (
												<td
													// biome-ignore lint/suspicious/noArrayIndexKey: column position is the stable identity (duplicate names possible)
													key={ci}
													className="border-gray-100 border-b px-3 py-1.5 align-top font-mono text-xs"
												>
													{formatCell(cell)}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<div className="px-3 py-4 text-gray-500 text-sm">
								No rows returned.
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
