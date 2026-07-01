"use client";

import { Gender } from "@prisma/client";
import {
	AlertCircle,
	CheckCircle2,
	FileSpreadsheet,
	Loader2,
	UploadCloud,
	X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "~/app/_components/shared/Button";
import { TagEditor } from "~/app/_components/shared/TagEditor";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/app/_components/shared/dialog";
import { Select } from "~/app/_components/shared/ui/select";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Fuzzy header matching
// ---------------------------------------------------------------------------

type FieldKey = "firstName" | "lastName" | "name" | "email" | "gender";

// Candidate header synonyms per logical field. Matching is fuzzy (normalized
// equality + substring + small Levenshtein distance) so spreadsheets with
// slightly different column titles (e.g. "E-mail Address", "Given Name",
// "Surname") still map correctly.
const FIELD_SYNONYMS: Record<FieldKey, string[]> = {
	firstName: ["firstname", "first", "fname", "givenname", "forename"],
	lastName: ["lastname", "last", "lname", "surname", "familyname"],
	name: ["name", "fullname", "clientname", "membername", "playername"],
	email: ["email", "emailaddress", "mail", "emailid", "contactemail"],
	gender: ["gender", "sex"],
};

function normalize(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const prev = new Array<number>(n + 1);
	const curr = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(
				(curr[j - 1] ?? 0) + 1,
				(prev[j] ?? 0) + 1,
				(prev[j - 1] ?? 0) + cost,
			);
		}
		for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0;
	}
	return prev[n] ?? 0;
}

// Score a header against a field's synonyms. Higher = better match (0 = none).
function scoreHeader(header: string, field: FieldKey): number {
	const h = normalize(header);
	if (!h) return 0;
	let best = 0;
	for (const syn of FIELD_SYNONYMS[field]) {
		if (h === syn) {
			best = Math.max(best, 100);
			continue;
		}
		if (h.includes(syn) || syn.includes(h)) {
			best = Math.max(best, 70);
			continue;
		}
		const dist = levenshtein(h, syn);
		const maxLen = Math.max(h.length, syn.length);
		// Allow ~25% character difference for a fuzzy match.
		if (dist <= Math.max(1, Math.floor(maxLen * 0.25))) {
			best = Math.max(best, 60 - dist * 5);
		}
	}
	return best;
}

// Map each spreadsheet column index to the best logical field (if any).
function matchColumns(headers: string[]): Partial<Record<FieldKey, number>> {
	const fields: FieldKey[] = [
		"firstName",
		"lastName",
		"name",
		"email",
		"gender",
	];
	// Build (field, colIndex, score) candidates, then greedily assign the
	// highest-scoring pairs so each field and column is used at most once.
	const candidates: { field: FieldKey; col: number; score: number }[] = [];
	headers.forEach((header, col) => {
		for (const field of fields) {
			const score = scoreHeader(header, field);
			if (score > 0) candidates.push({ field, col, score });
		}
	});
	candidates.sort((a, b) => b.score - a.score);

	const map: Partial<Record<FieldKey, number>> = {};
	const usedCols = new Set<number>();
	for (const c of candidates) {
		if (map[c.field] !== undefined) continue;
		if (usedCols.has(c.col)) continue;
		map[c.field] = c.col;
		usedCols.add(c.col);
	}
	return map;
}

function parseGender(raw: string): Gender | null {
	const g = normalize(raw);
	if (["male", "m", "boy", "man"].includes(g)) return Gender.MALE;
	if (["female", "f", "girl", "woman"].includes(g)) return Gender.FEMALE;
	return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParsedRow = {
	rowNumber: number;
	firstName: string;
	lastName: string;
	email: string;
	gender: Gender | null;
	rawGender: string;
	eligible: boolean;
	reason?: string;
};

type ImportResult = {
	email: string;
	firstName: string;
	lastName: string;
	status: "created" | "skipped" | "error";
	message?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImportClientsModal({
	open,
	onClose,
	toast,
}: {
	open: boolean;
	onClose: () => void;
	toast: (msg: string, variant: "success" | "error") => void;
}) {
	const utils = api.useUtils();
	const { data: facilities } = api.calendar.getFacilities.useQuery();

	const [fileName, setFileName] = useState("");
	const [parseError, setParseError] = useState("");
	const [rows, setRows] = useState<ParsedRow[]>([]);
	const [facilityId, setFacilityId] = useState("");
	const [isDragging, setIsDragging] = useState(false);
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [results, setResults] = useState<ImportResult[] | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const resolvedFacilityId = facilityId || facilities?.[0]?.facilityId || "";

	const eligibleRows = useMemo(() => rows.filter((r) => r.eligible), [rows]);
	const ineligibleRows = useMemo(() => rows.filter((r) => !r.eligible), [rows]);

	const bulkCreate = api.user.bulkCreateUsers.useMutation({
		onSuccess: async (data) => {
			setResults(data.results);
			// Force the clients list (and tag filters) to refetch immediately,
			// bypassing staleTime so the table shows the newly imported users.
			await Promise.all([
				utils.user.listClubUsers.invalidate(undefined, {
					refetchType: "all",
				}),
				utils.user.listClubTags.invalidate(),
			]);
			const { created, skipped, errored } = data.summary;
			toast(
				`Import complete: ${created} created, ${skipped} skipped, ${errored} failed`,
				errored > 0 ? "error" : "success",
			);
		},
		onError: (err) => {
			setParseError(err.message);
		},
	});

	const reset = useCallback(() => {
		setFileName("");
		setParseError("");
		setRows([]);
		setResults(null);
		setIsDragging(false);
		setSelectedTagIds([]);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}, []);

	const handleClose = useCallback(() => {
		reset();
		onClose();
	}, [reset, onClose]);

	const processFile = useCallback(async (file: File) => {
		setParseError("");
		setResults(null);
		setRows([]);
		setFileName(file.name);

		try {
			const buf = await file.arrayBuffer();
			const wb = XLSX.read(buf, { type: "array" });
			const sheetName = wb.SheetNames[0];
			if (!sheetName) {
				setParseError("The file has no sheets.");
				return;
			}
			const ws = wb.Sheets[sheetName];
			if (!ws) {
				setParseError("Could not read the first sheet.");
				return;
			}
			const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
				header: 1,
				blankrows: false,
				defval: "",
				raw: false,
			});

			if (matrix.length < 2) {
				setParseError(
					"The file needs a header row plus at least one data row.",
				);
				return;
			}

			const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());

			// Requirement: file must contain at least 3 columns of data.
			const nonEmptyHeaders = headers.filter((h) => h.length > 0);
			if (nonEmptyHeaders.length < 3) {
				setParseError(
					"The file must contain at least 3 columns (e.g. Name, Email, Gender).",
				);
				return;
			}

			const colMap = matchColumns(headers);

			const hasName =
				colMap.name !== undefined ||
				colMap.firstName !== undefined ||
				colMap.lastName !== undefined;
			if (
				!hasName ||
				colMap.email === undefined ||
				colMap.gender === undefined
			) {
				const missing: string[] = [];
				if (!hasName) missing.push("Name");
				if (colMap.email === undefined) missing.push("Email");
				if (colMap.gender === undefined) missing.push("Gender");
				setParseError(
					`Couldn't match required column(s): ${missing.join(", ")}. Detected headers: ${nonEmptyHeaders.join(", ")}.`,
				);
				return;
			}

			const cell = (r: string[], idx?: number) =>
				idx === undefined ? "" : String(r[idx] ?? "").trim();

			const parsed: ParsedRow[] = [];
			for (let i = 1; i < matrix.length; i++) {
				const r = matrix[i] ?? [];
				let firstName = cell(r, colMap.firstName);
				let lastName = cell(r, colMap.lastName);

				// If first/last weren't separate columns, split a combined name.
				if ((!firstName || !lastName) && colMap.name !== undefined) {
					const full = cell(r, colMap.name);
					const parts = full.split(/\s+/).filter(Boolean);
					if (!firstName) firstName = parts[0] ?? "";
					if (!lastName) lastName = parts.slice(1).join(" ");
				}

				const email = cell(r, colMap.email);
				const rawGender = cell(r, colMap.gender);
				const gender = parseGender(rawGender);

				// Skip fully empty trailing rows.
				if (!firstName && !lastName && !email && !rawGender) continue;

				let eligible = true;
				let reason: string | undefined;
				if (!firstName) {
					eligible = false;
					reason = "Missing first name";
				} else if (!lastName) {
					eligible = false;
					reason = "Missing last name";
				} else if (!email || !EMAIL_RE.test(email)) {
					eligible = false;
					reason = email ? "Invalid email" : "Missing email";
				} else if (!gender) {
					eligible = false;
					reason = rawGender ? "Unrecognized gender" : "Missing gender";
				}

				parsed.push({
					rowNumber: i + 1,
					firstName,
					lastName,
					email,
					gender,
					rawGender,
					eligible,
					reason,
				});
			}

			if (parsed.length === 0) {
				setParseError("No data rows found in the file.");
				return;
			}

			setRows(parsed);
		} catch (err) {
			setParseError(
				err instanceof Error
					? `Failed to parse file: ${err.message}`
					: "Failed to parse the file.",
			);
		}
	}, []);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			const file = e.dataTransfer.files?.[0];
			if (file) void processFile(file);
		},
		[processFile],
	);

	function handleConfirm() {
		if (eligibleRows.length === 0) return;
		bulkCreate.mutate({
			facilityId: resolvedFacilityId || undefined,
			tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
			rows: eligibleRows.map((r) => ({
				firstName: r.firstName,
				lastName: r.lastName,
				email: r.email,
				gender: r.gender as Gender,
			})),
		});
	}

	return (
		<Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Import Clients</DialogTitle>
					<DialogDescription>
						Upload a CSV or Excel file. It must contain at least 3 columns
						including <strong>Name</strong>, <strong>Email</strong>, and{" "}
						<strong>Gender</strong>. Column names are matched automatically.
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="max-h-[60vh] overflow-y-auto">
					{/* In-flight notice: sets expectations and reassures the user
					    it's safe to close the dialog while the import runs. */}
					{bulkCreate.isPending && (
						<div className="flex items-start gap-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--accent)] px-3 py-2.5 text-sm">
							<Loader2
								size={16}
								className="mt-0.5 shrink-0 animate-spin text-[var(--primary)]"
							/>
							<p className="text-[var(--foreground)]">
								Importing {eligibleRows.length} account
								{eligibleRows.length === 1 ? "" : "s"}. This can take a couple
								of minutes for large batches — feel free to close this dialog
								and we'll let you know when it's done.
							</p>
						</div>
					)}

					{/* Results view (after import) */}
					{results ? (
						<ImportResultsView results={results} />
					) : rows.length === 0 ? (
						/* Drop zone */
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							onDragOver={(e) => {
								e.preventDefault();
								setIsDragging(true);
							}}
							onDragLeave={() => setIsDragging(false)}
							onDrop={onDrop}
							className={`flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
								isDragging
									? "border-[var(--primary)] bg-[var(--accent)]"
									: "border-gray-300 hover:border-gray-400"
							}`}
						>
							<UploadCloud size={36} className="text-gray-400" />
							<div className="space-y-1">
								<p className="font-medium text-[var(--foreground)] text-sm">
									Drag &amp; drop a file here, or click to browse
								</p>
								<p className="text-[var(--muted-foreground)] text-xs">
									Supports .csv, .xlsx, .xls
								</p>
							</div>
							<input
								ref={fileInputRef}
								type="file"
								accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) void processFile(file);
								}}
							/>
						</button>
					) : (
						/* Preview view */
						<div className="space-y-4">
							<div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
								<div className="flex min-w-0 items-center gap-2">
									<FileSpreadsheet
										size={16}
										className="shrink-0 text-gray-500"
									/>
									<span className="truncate text-sm">{fileName}</span>
								</div>
								<Button variant="ghost" size="sm" onClick={reset}>
									<X size={14} className="mr-1" /> Change file
								</Button>
							</div>

							<div className="flex flex-wrap items-center gap-4">
								<span className="inline-flex items-center gap-1.5 text-green-700 text-sm">
									<CheckCircle2 size={15} />
									{eligibleRows.length} eligible
								</span>
								{ineligibleRows.length > 0 && (
									<span className="inline-flex items-center gap-1.5 text-amber-700 text-sm">
										<AlertCircle size={15} />
										{ineligibleRows.length} skipped
									</span>
								)}

								<div className="ml-auto flex items-center gap-2">
									<label
										htmlFor="import-facility"
										className="font-medium text-[var(--muted-foreground)] text-xs"
									>
										Facility
									</label>
									<Select
										id="import-facility"
										value={resolvedFacilityId}
										onChange={(e) => setFacilityId(e.target.value)}
										className="h-auto w-auto py-1 text-xs"
									>
										{facilities?.map((f) => (
											<option key={f.facilityId} value={f.facilityId}>
												{f.name}
											</option>
										))}
									</Select>
								</div>
							</div>

							<div className="space-y-2">
								<span className="block font-medium text-[var(--muted-foreground)] text-xs">
									Tags for this batch
								</span>
								<TagEditor
									selectedTagIds={selectedTagIds}
									onChange={setSelectedTagIds}
								/>
							</div>

							<div className="overflow-x-auto rounded-lg border border-gray-200">
								<table className="w-full text-left text-sm">
									<thead>
										<tr className="border-gray-200 border-b bg-gray-50 text-[var(--muted-foreground)] text-xs">
											<th className="px-3 py-2 font-medium">Row</th>
											<th className="px-3 py-2 font-medium">First</th>
											<th className="px-3 py-2 font-medium">Last</th>
											<th className="px-3 py-2 font-medium">Email</th>
											<th className="px-3 py-2 font-medium">Gender</th>
											<th className="px-3 py-2 font-medium">Status</th>
										</tr>
									</thead>
									<tbody>
										{rows.map((r) => (
											<tr
												key={r.rowNumber}
												className={`border-gray-100 border-b last:border-b-0 ${
													r.eligible ? "" : "bg-amber-50/60"
												}`}
											>
												<td className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
													{r.rowNumber}
												</td>
												<td className="px-3 py-2">{r.firstName || "—"}</td>
												<td className="px-3 py-2">{r.lastName || "—"}</td>
												<td className="px-3 py-2">{r.email || "—"}</td>
												<td className="px-3 py-2">
													{r.gender ?? (r.rawGender || "—")}
												</td>
												<td className="px-3 py-2">
													{r.eligible ? (
														<span className="inline-flex items-center gap-1 text-green-700 text-xs">
															<CheckCircle2 size={13} /> Ready
														</span>
													) : (
														<span className="inline-flex items-center gap-1 text-amber-700 text-xs">
															<AlertCircle size={13} /> {r.reason}
														</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{parseError && (
						<p className="mt-3 flex items-start gap-1.5 text-red-500 text-xs">
							<AlertCircle size={14} className="mt-px shrink-0" />
							{parseError}
						</p>
					)}
				</DialogBody>

				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={handleClose}>
						{bulkCreate.isPending
							? "Close (import will continue)"
							: results
								? "Close"
								: "Cancel"}
					</Button>
					{!results && rows.length > 0 && (
						<Button
							onClick={handleConfirm}
							disabled={eligibleRows.length === 0 || bulkCreate.isPending}
						>
							{bulkCreate.isPending
								? "Creating..."
								: `Create ${eligibleRows.length} account${
										eligibleRows.length === 1 ? "" : "s"
									}`}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Results sub-view
// ---------------------------------------------------------------------------

function ImportResultsView({ results }: { results: ImportResult[] }) {
	const STATUS_STYLES: Record<ImportResult["status"], string> = {
		created: "text-green-700",
		skipped: "text-amber-700",
		error: "text-red-600",
	};
	const STATUS_LABEL: Record<ImportResult["status"], string> = {
		created: "Created",
		skipped: "Skipped",
		error: "Failed",
	};

	return (
		<div className="overflow-x-auto rounded-lg border border-gray-200">
			<table className="w-full text-left text-sm">
				<thead>
					<tr className="border-gray-200 border-b bg-gray-50 text-[var(--muted-foreground)] text-xs">
						<th className="px-3 py-2 font-medium">Name</th>
						<th className="px-3 py-2 font-medium">Email</th>
						<th className="px-3 py-2 font-medium">Result</th>
					</tr>
				</thead>
				<tbody>
					{results.map((r, i) => (
						<tr
							key={`${r.email}-${i}`}
							className="border-gray-100 border-b last:border-b-0"
						>
							<td className="px-3 py-2">
								{r.firstName} {r.lastName}
							</td>
							<td className="px-3 py-2 text-[var(--muted-foreground)]">
								{r.email}
							</td>
							<td className={`px-3 py-2 text-xs ${STATUS_STYLES[r.status]}`}>
								{STATUS_LABEL[r.status]}
								{r.message ? ` — ${r.message}` : ""}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
