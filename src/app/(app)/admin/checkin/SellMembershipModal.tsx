"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "~/app/_components/hooks/use-debounced-value";
import BillToUserPicker from "~/app/_components/shared/BillToUserPicker";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

/**
 * Phase 10a (WP4a) — Sell Membership flow (member-facing UI).
 *
 * Mirrors `SellPackageModal` structure intentionally (slide-out panel, plan
 * picker, optional bill-to/payer typeahead, debounced `user.searchMembers`,
 * outside-click dismissal) and adds the membership-specific bits:
 *  - a MEMBER picker (also `user.searchMembers`) used only when the modal is
 *    opened standalone; when launched from a member profile the consumer is
 *    passed in and locked.
 *  - a START DATE (`<input type="date">` via the shared `Input`) that must be
 *    today or future (>= today; backdating is disallowed in 10a). A future
 *    start renders the membership as "Upcoming".
 *  - a FULL-TERM fee + term-end PREVIEW. There is NO proration in 10a (NVBC is
 *    signup-anchored, every term is a full calendar period), so the preview is
 *    simply the plan's `feePerTermInCents` plus the calendar term end derived
 *    from the start date + the plan's billingUnit/billingInterval. The
 *    authoritative `endDate` + fee line item are computed server-side at sale;
 *    this is an at-a-glance preview only.
 *
 * Calls `api.memberships.sell`. The membership router is implemented by a
 * parallel agent, so `api.memberships.*` may not resolve in typecheck until the
 * backend lands — expected; the call is written per the WP4a contract.
 */

type SearchUser = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
};

// Mirror of the `MembershipPlan` rows we consume from `api.memberships
// .listPlans`. Declared locally so the modal stays well-typed even before the
// router resolves; matches the schema (prisma/schema.prisma `MembershipPlan`).
type MembershipPlanRow = {
	membershipPlanId: string;
	description: string;
	billingFrequency: string;
	billingInterval: number;
	billingUnit: string;
	feePerTermInCents: number;
	membershipType: { name: string } | null;
};

interface SellMembershipModalProps {
	/**
	 * The beneficiary/consumer. When provided (opened from a member profile) the
	 * member is pre-selected and locked. When omitted the in-modal member picker
	 * is shown (standalone / plan-launched use).
	 */
	userId?: string;
	memberName?: string;
	onClose: () => void;
	/** Fired after a successful sale so the host can refetch its list. */
	onSold?: () => void;
}

function formatUserName(u: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
	return name || "(no name)";
}

/** Today's date as a yyyy-mm-dd string for the date input min + default. */
function todayISO(): string {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * PREVIEW-ONLY calendar term-end helper. Mirrors the WP2 server helper's
 * calendar arithmetic (monthly Feb 15 -> Mar 14; yearly Feb 15 '26 -> Feb 14
 * '27) including last-day-of-month clamping when the anchor day overflows a
 * short month. The term END is the last day BEFORE the next period's anchor,
 * i.e. (start + interval units) - 1 day. The server computes the authoritative
 * value at sale; this only drives the on-screen preview.
 *
 * Parses the yyyy-mm-dd input as a LOCAL calendar date (not UTC) to avoid an
 * off-by-one from timezone shifts.
 */
function previewTermEnd(
	startISO: string,
	billingUnit: string,
	billingInterval: number,
): Date | null {
	const parts = startISO.split("-").map((p) => Number.parseInt(p, 10));
	if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
	const [year, month, day] = parts as [number, number, number];
	const interval = billingInterval > 0 ? billingInterval : 1;

	// Advance to the next period's anchor, then step back one day for the term end.
	let nextYear = year;
	let nextMonth = month - 1; // 0-indexed for Date math
	let nextDay = day;

	switch (billingUnit) {
		case "day":
			// Day-based terms: a 30-"day" term ends on start + (30 - 1) days.
			return new Date(year, month - 1, day + interval - 1);
		case "week":
			return new Date(year, month - 1, day + interval * 7 - 1);
		case "month":
			nextMonth = month - 1 + interval;
			break;
		case "year":
			nextYear = year + interval;
			break;
		default:
			return null;
	}

	// Normalise month overflow into years.
	nextYear += Math.floor(nextMonth / 12);
	nextMonth = ((nextMonth % 12) + 12) % 12;

	// Clamp the anchor day to the last valid day of the target month (e.g. an
	// anchor of the 31st landing in a 30-day month -> the 30th), preserving the
	// anchor where the month allows. Day 0 of (month+1) = last day of `month`.
	const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
	if (nextDay > daysInNextMonth) nextDay = daysInNextMonth;

	// Next period's anchor, minus one day = this term's last day.
	const nextAnchor = new Date(nextYear, nextMonth, nextDay);
	nextAnchor.setDate(nextAnchor.getDate() - 1);
	return nextAnchor;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function SellMembershipModal({
	userId: lockedUserId,
	memberName: lockedMemberName,
	onClose,
	onSold,
}: SellMembershipModalProps) {
	const { toast } = useToast();
	const utils = api.useUtils();

	const memberLocked = !!lockedUserId;

	// --- Member picker (only when not launched from a profile) ---
	const [memberQuery, setMemberQuery] = useState("");
	const [selectedMember, setSelectedMember] = useState<SearchUser | null>(null);
	const [showMemberDropdown, setShowMemberDropdown] = useState(true);
	const memberWrapperRef = useRef<HTMLDivElement>(null);

	// --- Plan + start date ---
	const [selectedPlanId, setSelectedPlanId] = useState("");
	const [startDate, setStartDate] = useState<string>(todayISO());
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);

	// --- Bill-to / payer — the shared BillToUserPicker (as SellPackageModal). ---
	const [billToUser, setBillToUser] = useState<SearchUser | null>(null);
	const [billToTypedButUnselected, setBillToTypedButUnselected] =
		useState(false);

	const today = todayISO();

	// The effective consumer id/name: the locked profile, or the picked member.
	const consumerId = lockedUserId ?? selectedMember?.userId ?? null;
	const consumerName = memberLocked
		? (lockedMemberName ?? "this member")
		: selectedMember
			? formatUserName(selectedMember)
			: "this member";

	// Debounce the member typeahead (200ms) — matches SellPackageModal.
	const debouncedMemberQuery = useDebouncedValue(memberQuery, 200);

	// Outside-click dismissal for the member dropdown (mirrors SellPackageModal Fix E).
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				memberWrapperRef.current &&
				!memberWrapperRef.current.contains(e.target as Node)
			) {
				setShowMemberDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Active membership plans for the picker.
	const { data: plansData, isLoading: plansLoading } =
		api.memberships.listPlans.useQuery({ isActive: true });
	const plans = (plansData?.plans ?? []) as MembershipPlanRow[];
	const selectedPlan = plans.find((p) => p.membershipPlanId === selectedPlanId);

	// Member search query (only when picker is shown + 4+ chars typed).
	const trimmedMemberQuery = memberQuery.trim();
	const trimmedDebouncedMemberQuery = debouncedMemberQuery.trim();
	const memberSearchEnabled =
		!memberLocked &&
		selectedMember === null &&
		trimmedDebouncedMemberQuery.length >= 4;
	const memberSearch = api.user.searchMembers.useQuery(
		{ query: trimmedDebouncedMemberQuery },
		{ enabled: memberSearchEnabled },
	);
	const memberResults = memberSearch.data?.members ?? [];

	// Full-term fee + term-end preview (no proration).
	const termEndPreview = useMemo(() => {
		if (!selectedPlan || !startDate) return null;
		return previewTermEnd(
			startDate,
			selectedPlan.billingUnit,
			selectedPlan.billingInterval,
		);
	}, [selectedPlan, startDate]);

	const startInFuture = startDate > today;

	const sellMutation = api.memberships.sell.useMutation({
		onSuccess: () => {
			if (consumerId) {
				void utils.memberships.listForMember.invalidate({
					userId: consumerId,
				});
			}
			toast("Membership sold", "success");
			onSold?.();
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => setSaving(false),
	});

	const handleClose = () => {
		if (saving) return;
		onClose();
	};

	const handleSell = () => {
		if (!consumerId) {
			toast("Select a member", "error");
			return;
		}
		if (!selectedPlanId) {
			toast("Select a membership plan", "error");
			return;
		}
		if (!startDate) {
			toast("Pick a start date", "error");
			return;
		}
		if (startDate < today) {
			toast("Start date can't be in the past", "error");
			return;
		}
		setSaving(true);
		sellMutation.mutate({
			userId: consumerId,
			membershipPlanId: selectedPlanId,
			// yyyy-mm-dd; the server interprets it in the member's facility tz.
			startDate,
			notes: notes.trim() || undefined,
			// Only send billToUserId when a different payer was explicitly picked.
			...(billToUser ? { billToUserId: billToUser.userId } : {}),
		});
	};

	const sellDisabled =
		!consumerId ||
		!selectedPlanId ||
		!startDate ||
		startDate < today ||
		saving ||
		billToTypedButUnselected;

	return (
		<>
			{/* Backdrop */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: supplementary click-to-dismiss; the modal is fully operable via the Cancel button. */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : handleClose}
			/>

			{/* Modal */}
			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<h2 className="font-semibold text-[var(--foreground)] text-base">
						{memberLocked
							? `Sell Membership to ${lockedMemberName}`
							: "Sell Membership"}
					</h2>
					<button
						onClick={handleClose}
						disabled={saving}
						className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
						aria-label="Close"
						type="button"
					>
						<X size={18} />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
					{/* Member picker — only when not launched from a profile */}
					{!memberLocked && (
						<div className="space-y-1">
							<label
								htmlFor="sell-membership-member"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Member <span className="text-red-500">*</span>
							</label>
							{selectedMember ? (
								<div className="flex flex-wrap items-center gap-2">
									<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-3 py-1 text-[var(--foreground)] text-sm">
										<span className="font-medium">
											{formatUserName(selectedMember)}
										</span>
										{selectedMember.email ? (
											<span className="text-[var(--muted-foreground)] text-xs">
												({selectedMember.email})
											</span>
										) : null}
										<button
											type="button"
											onClick={() => {
												setSelectedMember(null);
												setMemberQuery("");
											}}
											disabled={saving}
											aria-label="Clear selected member"
											className="ml-1 rounded-full p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-50"
										>
											<X size={12} />
										</button>
									</span>
								</div>
							) : (
								<div ref={memberWrapperRef} className="relative">
									<Input
										id="sell-membership-member"
										value={memberQuery}
										onChange={(e) => {
											setMemberQuery(e.target.value);
											setShowMemberDropdown(true);
										}}
										onFocus={() => setShowMemberDropdown(true)}
										placeholder="Search by name or email..."
										disabled={saving}
										autoComplete="off"
										maxLength={100}
										className="h-9"
									/>
									{trimmedMemberQuery.length > 0 && showMemberDropdown && (
										<div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] shadow-md">
											{trimmedMemberQuery.length < 4 ? (
												<p className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
													Type at least 4 characters to search.
												</p>
											) : memberSearch.isLoading ||
												trimmedMemberQuery !== trimmedDebouncedMemberQuery ? (
												<p className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
													Searching...
												</p>
											) : memberResults.length === 0 ? (
												<p className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
													No matches found.
												</p>
											) : (
												<ul className="py-1">
													{memberResults.map((r) => (
														<li key={r.userId}>
															<button
																type="button"
																onClick={() => {
																	setSelectedMember(r);
																	setMemberQuery("");
																}}
																className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
															>
																<span className="text-[var(--foreground)]">
																	{formatUserName(r)}
																</span>
																{r.email ? (
																	<span className="text-[var(--muted-foreground)] text-xs">
																		{r.email}
																	</span>
																) : null}
															</button>
														</li>
													))}
												</ul>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* Plan picker */}
					<div className="space-y-1">
						<label
							htmlFor="sell-membership-plan"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Membership Plan <span className="text-red-500">*</span>
						</label>
						{plansLoading ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								Loading...
							</p>
						) : plans.length === 0 ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								No active membership plans. Create one under{" "}
								<a href="/admin/memberships/plans" className="underline">
									Memberships
								</a>
								.
							</p>
						) : (
							<Select
								id="sell-membership-plan"
								value={selectedPlanId}
								onChange={(e) => setSelectedPlanId(e.target.value)}
								className="h-9"
								disabled={saving}
							>
								<option value="">— Select a plan —</option>
								{plans.map((plan) => (
									<option
										key={plan.membershipPlanId}
										value={plan.membershipPlanId}
									>
										{plan.membershipType?.name
											? `${plan.membershipType.name} — `
											: ""}
										{plan.description} ({formatCents(plan.feePerTermInCents)})
									</option>
								))}
							</Select>
						)}
					</div>

					{/* Start date */}
					<div className="space-y-1">
						<label
							htmlFor="sell-membership-start"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Start Date <span className="text-red-500">*</span>
						</label>
						<Input
							id="sell-membership-start"
							type="date"
							value={startDate}
							min={today}
							onChange={(e) => setStartDate(e.target.value)}
							disabled={saving}
							className="h-9"
						/>
						<p className="text-[var(--muted-foreground)] text-xs">
							{startInFuture
								? "Future start — the membership shows as Upcoming until this date. The fee is billed now."
								: "Today or a future date. Backdating isn't supported."}
						</p>
					</div>

					{/* Full-term fee + term-end preview (no proration) */}
					{selectedPlan && (
						<div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm">
							<div className="grid grid-cols-2 gap-2">
								<div className="text-[var(--muted-foreground)]">Type</div>
								<div className="text-[var(--foreground)]">
									{selectedPlan.membershipType?.name ?? "—"}
								</div>
								<div className="text-[var(--muted-foreground)]">Billing</div>
								<div className="text-[var(--foreground)]">
									every {selectedPlan.billingInterval}{" "}
									{selectedPlan.billingUnit}
									{selectedPlan.billingInterval !== 1 ? "s" : ""}
								</div>
								<div className="text-[var(--muted-foreground)]">Term ends</div>
								<div className="text-[var(--foreground)]">
									{termEndPreview ? formatDate(termEndPreview) : "—"}
								</div>
								<div className="text-[var(--muted-foreground)]">
									Full-term fee
								</div>
								<div className="font-semibold text-[var(--foreground)]">
									{formatCents(selectedPlan.feePerTermInCents)}
								</div>
							</div>
							<p className="mt-3 border-[var(--border)] border-t pt-2 text-[var(--muted-foreground)] text-xs">
								No proration — a full term is charged at sale. Final dates are
								confirmed when the sale is recorded.
							</p>
						</div>
					)}

					{/* Notes */}
					<div className="space-y-1">
						<label
							htmlFor="sell-membership-notes"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Notes
						</label>
						<textarea
							id="sell-membership-notes"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={3}
							placeholder="Optional notes"
							maxLength={2000}
							disabled={saving}
							className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
						/>
					</div>

					{/* Bill to (optional) — shared picker, same as SellPackageModal */}
					<BillToUserPicker
						consumerId={consumerId ?? ""}
						value={billToUser}
						onChange={setBillToUser}
						disabled={saving}
						label="Bill to (optional)"
						helperText={`Leave blank to bill ${consumerName} directly.`}
						onTypedButUnselectedChange={setBillToTypedButUnselected}
					/>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
					<Button
						variant="outline"
						size="sm"
						onClick={handleClose}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSell} disabled={sellDisabled}>
						{saving ? "Selling..." : "Sell Membership"}
					</Button>
				</div>
			</div>
		</>
	);
}
