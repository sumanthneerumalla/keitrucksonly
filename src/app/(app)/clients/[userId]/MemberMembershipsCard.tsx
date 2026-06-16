"use client";

import { BadgeCheck } from "lucide-react";
import { useMemo, useState } from "react";
import SellMembershipModal from "~/app/(app)/admin/checkin/SellMembershipModal";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/app/_components/shared/ui/tooltip";
import {
	MEMBERSHIP_TONE_BADGE_STYLES,
	type MembershipStatusInput,
	membershipStatusDisplay,
} from "~/lib/membershipStatus";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

/**
 * Phase 10a (WP6) — Member's Membership view (profile tab/section).
 *
 * Renders a LIST (a member may hold MULTIPLE concurrent/overlapping memberships
 * — no one-active limit), each row showing plan + a DERIVED status badge
 * (green=active, blue=upcoming, yellow=expired, red=cancelled/suspended/frozen,
 * via `src/lib/membershipStatus.ts`) + dates + contextual actions. A "Show
 * history" toggle reveals expired/cancelled/voided rows (active-by-default #4).
 *
 * Actions per stored status (mirrors the WP4b transition graph):
 *  - active  -> Freeze, Suspend, Cancel (each requires a remark)
 *  - frozen  -> Unfreeze (extends endDate server-side)
 *  - suspended -> Reinstate
 *  - cancelled -> terminal; admins may still Void
 *  - Void (admin only, any non-voided row) — soft-delete a mistake.
 *
 * Cancel's MANUAL refund amount is recorded separately via the existing
 * RecordRefund flow (decision: 10a cancel-refund = manual). This card collects
 * the cancellation remark and calls `api.memberships.cancel`; it does not own
 * the refund modal.
 *
 * Calls `api.memberships.{listForMember,freeze,unfreeze,suspend,reinstate,
 * cancel,void}` — implemented by a parallel agent; may not resolve in typecheck
 * until the backend lands (expected). Mirrors `MemberPackagesCard` structure.
 */

interface MemberMembershipsCardProps {
	userId: string;
	memberName: string;
}

// Mirror of a `MemberMembership` row (with plan/type joined) returned by
// `api.memberships.listForMember`. Declared locally so the card stays typed
// before the router resolves; matches prisma/schema.prisma `MemberMembership`.
type MembershipRow = {
	memberMembershipId: string;
	status: string;
	startDate: Date | string;
	endDate: Date | string | null;
	freezeReason: string | null;
	suspendReason: string | null;
	cancelReason: string | null;
	// Phase 10c — coverage hint (1 = individual, N>1 = cap, null = family/no cap).
	memberCapacity: number | null;
	membershipPlan: {
		description: string;
		membershipType: { name: string } | null;
	} | null;
};

// Phase 10c — coverage label; null for individual plans (no need to clutter).
function coverageLabel(cap: number | null): string | null {
	if (cap === null) return "Covers family";
	if (cap <= 1) return null;
	return `Covers up to ${cap}`;
}

// The set of remark-collecting actions. Each opens an AlertDialog with a
// required textarea.
type RemarkAction = "freeze" | "suspend" | "cancel" | "void";

function formatDate(date: Date | string | null): string {
	if (!date) return "—";
	return new Date(date).toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function StatusBadge({ row }: { row: MembershipRow }) {
	const display = membershipStatusDisplay({
		status: row.status,
		startDate: row.startDate,
		endDate: row.endDate,
	} satisfies MembershipStatusInput);
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${MEMBERSHIP_TONE_BADGE_STYLES[display.tone]}`}
		>
			{display.label}
		</span>
	);
}

const REMARK_ACTION_COPY: Record<
	RemarkAction,
	{ title: string; description: string; confirm: string; destructive: boolean }
> = {
	freeze: {
		title: "Freeze membership",
		description:
			"Pause this membership at the member's request. The freeze duration extends the end date when you unfreeze. A remark is required.",
		confirm: "Freeze",
		destructive: false,
	},
	suspend: {
		title: "Suspend membership",
		description:
			"Suspend this membership (disciplinary/administrative). No date extension. A remark is required.",
		confirm: "Suspend",
		destructive: true,
	},
	cancel: {
		title: "Cancel membership",
		description:
			"End this membership early — this can't be undone (sell a new one to restart). Record any refund separately. A remark is required.",
		confirm: "Cancel membership",
		destructive: true,
	},
	void: {
		title: "Void membership",
		description:
			"Soft-delete a mistaken membership (wrong member/duplicate). Voids the unpaid fee off the tab and hides this row. A remark is required.",
		confirm: "Void",
		destructive: true,
	},
};

export default function MemberMembershipsCard({
	userId,
	memberName,
}: MemberMembershipsCardProps) {
	const { toast } = useToast();
	const utils = api.useUtils();

	const [sellOpen, setSellOpen] = useState(false);
	const [showHistory, setShowHistory] = useState(false);

	// Remark-action dialog target: which membership + which action.
	const [remarkTarget, setRemarkTarget] = useState<{
		membership: MembershipRow;
		action: RemarkAction;
	} | null>(null);
	const [remark, setRemark] = useState("");

	const { data: currentUser } = api.user.getOrCreateProfile.useQuery();
	const canVoid = currentUser ? isAnyAdmin(currentUser) : false;

	const { data, isLoading } = api.memberships.listForMember.useQuery(
		{ userId },
		{ enabled: !!userId },
	);

	// Phase 10c — memberships this person is covered by THROUGH their family (a
	// shareable membership a family member holds). Shown read-only here so the
	// coverage "belongs" to them on their own profile, even though it's billed to
	// (and managed from) the primary's profile.
	const { data: coverageData } = api.memberships.coverageForMember.useQuery(
		{ userId },
		{ enabled: !!userId },
	);
	const familyShared = (coverageData?.coverage.rows ?? []).filter(
		(r) => r.coverageSource === "family",
	);

	const memberships = (data?.memberships ?? []) as MembershipRow[];

	// Split into active-by-default vs history using the shared derive helper.
	const { current, history } = useMemo(() => {
		const cur: MembershipRow[] = [];
		const hist: MembershipRow[] = [];
		for (const m of memberships) {
			const d = membershipStatusDisplay({
				status: m.status,
				startDate: m.startDate,
				endDate: m.endDate,
			});
			if (d.hidden) {
				// Voided rows: only surface under history, and only for admins who
				// can act on them. Hidden from the default view.
				if (canVoid) hist.push(m);
				continue;
			}
			if (d.isHistory) hist.push(m);
			else cur.push(m);
		}
		return { current: cur, history: hist };
	}, [memberships, canVoid]);

	const onActionSuccess = (msg: string) => {
		void utils.memberships.listForMember.invalidate({ userId });
		toast(msg, "success");
	};

	const freezeMutation = api.memberships.freeze.useMutation({
		onSuccess: () => onActionSuccess("Membership frozen"),
		onError: (err) => toast(err.message, "error"),
	});
	const unfreezeMutation = api.memberships.unfreeze.useMutation({
		onSuccess: () => onActionSuccess("Membership unfrozen"),
		onError: (err) => toast(err.message, "error"),
	});
	const suspendMutation = api.memberships.suspend.useMutation({
		onSuccess: () => onActionSuccess("Membership suspended"),
		onError: (err) => toast(err.message, "error"),
	});
	const reinstateMutation = api.memberships.reinstate.useMutation({
		onSuccess: () => onActionSuccess("Membership reinstated"),
		onError: (err) => toast(err.message, "error"),
	});
	const cancelMutation = api.memberships.cancel.useMutation({
		onSuccess: () => onActionSuccess("Membership cancelled"),
		onError: (err) => toast(err.message, "error"),
	});
	const voidMutation = api.memberships.void.useMutation({
		onSuccess: () => onActionSuccess("Membership voided"),
		onError: (err) => toast(err.message, "error"),
	});

	// `isPending` across all remark-action mutations gates the dialog confirm.
	const remarkActionPending =
		freezeMutation.isPending ||
		suspendMutation.isPending ||
		cancelMutation.isPending ||
		voidMutation.isPending;
	// Non-remark (instant) actions — disable their buttons while in flight.
	const instantActionPending =
		unfreezeMutation.isPending || reinstateMutation.isPending;

	const openRemarkDialog = (
		membership: MembershipRow,
		action: RemarkAction,
	) => {
		setRemark("");
		setRemarkTarget({ membership, action });
	};

	const confirmRemarkAction = () => {
		if (!remarkTarget || remarkActionPending) return;
		const trimmed = remark.trim();
		if (!trimmed) return; // confirm is disabled, but guard anyway
		const id = remarkTarget.membership.memberMembershipId;
		switch (remarkTarget.action) {
			case "freeze":
				freezeMutation.mutate({ memberMembershipId: id, reason: trimmed });
				break;
			case "suspend":
				suspendMutation.mutate({ memberMembershipId: id, reason: trimmed });
				break;
			case "cancel":
				cancelMutation.mutate({ memberMembershipId: id, reason: trimmed });
				break;
			case "void":
				voidMutation.mutate({ memberMembershipId: id, reason: trimmed });
				break;
		}
		setRemarkTarget(null);
	};

	const renderRow = (row: MembershipRow, isHistoryRow: boolean) => {
		const planName = row.membershipPlan?.description ?? "Membership";
		const typeName = row.membershipPlan?.membershipType?.name ?? null;

		return (
			<div
				key={row.memberMembershipId}
				className={`rounded border border-[var(--border)] p-2 ${isHistoryRow ? "opacity-70" : ""}`}
			>
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<p className="truncate font-medium text-[var(--foreground)] text-sm">
							{planName}
						</p>
						{typeName ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								{typeName}
							</p>
						) : null}
					</div>
					<StatusBadge row={row} />
				</div>

				<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[var(--muted-foreground)] text-xs">
					<span>
						{formatDate(row.startDate)} – {formatDate(row.endDate)}
					</span>
					{coverageLabel(row.memberCapacity) && (
						<span className="rounded-full bg-[var(--muted)] px-2 py-0.5">
							{coverageLabel(row.memberCapacity)}
						</span>
					)}
				</div>

				{/* Reason subtext for paused/terminal rows */}
				{row.status === "frozen" && row.freezeReason ? (
					<p className="mt-1 text-[var(--muted-foreground)] text-xs italic">
						Frozen: {row.freezeReason}
					</p>
				) : null}
				{row.status === "suspended" && row.suspendReason ? (
					<p className="mt-1 text-[var(--muted-foreground)] text-xs italic">
						Suspended: {row.suspendReason}
					</p>
				) : null}
				{row.status === "cancelled" && row.cancelReason ? (
					<p className="mt-1 text-[var(--muted-foreground)] text-xs italic">
						Cancelled: {row.cancelReason}
					</p>
				) : null}

				{/* Actions — contextual on stored status */}
				<div className="mt-2 flex flex-wrap justify-end gap-1.5">
					{row.status === "active" && (
						<>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="outline"
										size="sm"
										disabled={instantActionPending}
										onClick={() => openRemarkDialog(row, "freeze")}
									>
										Freeze
									</Button>
								</TooltipTrigger>
								<TooltipContent side="top" className="max-w-xs">
									{REMARK_ACTION_COPY.freeze.description}
								</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="outline"
										size="sm"
										disabled={instantActionPending}
										onClick={() => openRemarkDialog(row, "suspend")}
									>
										Suspend
									</Button>
								</TooltipTrigger>
								<TooltipContent side="top" className="max-w-xs">
									{REMARK_ACTION_COPY.suspend.description}
								</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="destructive-outline"
										size="sm"
										disabled={instantActionPending}
										onClick={() => openRemarkDialog(row, "cancel")}
									>
										Cancel
									</Button>
								</TooltipTrigger>
								<TooltipContent side="top" className="max-w-xs">
									{REMARK_ACTION_COPY.cancel.description}
								</TooltipContent>
							</Tooltip>
						</>
					)}
					{row.status === "frozen" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									disabled={unfreezeMutation.isPending}
									onClick={() =>
										unfreezeMutation.mutate({
											memberMembershipId: row.memberMembershipId,
										})
									}
								>
									Unfreeze
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top" className="max-w-xs">
								Resume the membership. The end date has been extended by the
								duration of the freeze.
							</TooltipContent>
						</Tooltip>
					)}
					{row.status === "suspended" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="sm"
									disabled={reinstateMutation.isPending}
									onClick={() =>
										reinstateMutation.mutate({
											memberMembershipId: row.memberMembershipId,
										})
									}
								>
									Reinstate
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top" className="max-w-xs">
								Resume this suspended membership. The end date stays the same.
							</TooltipContent>
						</Tooltip>
					)}
					{/* Void — admin only, any non-voided row (mistakes happen post-cancel too) */}
					{canVoid && row.status !== "voided" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="destructive-outline"
									size="sm"
									disabled={instantActionPending}
									onClick={() => openRemarkDialog(row, "void")}
								>
									Void
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top" className="max-w-xs">
								{REMARK_ACTION_COPY.void.description}
							</TooltipContent>
						</Tooltip>
					)}
				</div>
			</div>
		);
	};

	const remarkCopy = remarkTarget
		? REMARK_ACTION_COPY[remarkTarget.action]
		: null;

	return (
		<>
			<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
				<div className="mb-3 flex items-center justify-between">
					<h4 className="flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
						<BadgeCheck size={14} />
						Memberships
					</h4>
					<Button variant="outline" size="sm" onClick={() => setSellOpen(true)}>
						Sell Membership
					</Button>
				</div>

				{isLoading ? (
					<p className="text-[var(--muted-foreground)] text-xs">Loading...</p>
				) : current.length === 0 &&
					history.length === 0 &&
					familyShared.length === 0 ? (
					<p className="text-[var(--muted-foreground)] text-xs">
						No memberships
					</p>
				) : (
					<div className="space-y-2">
						{current.length === 0 ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								No active or upcoming memberships
							</p>
						) : (
							current.map((row) => renderRow(row, false))
						)}

						{/* Phase 10c — memberships covering this person through their
						    family. Read-only: managed from the primary's profile. */}
						{familyShared.map((row) => {
							const display = membershipStatusDisplay({
								status: row.status,
								startDate: row.startDate,
								endDate: row.endDate,
							});
							const planName =
								row.membershipTypeName || row.planDescription || "Membership";
							return (
								<div
									key={row.memberMembershipId}
									className="rounded border border-[var(--border)] border-dashed p-2"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="truncate font-medium text-[var(--foreground)] text-sm">
												{planName}
											</p>
											<p className="text-[var(--muted-foreground)] text-xs">
												Through family
												{row.sharedByName ? ` · via ${row.sharedByName}` : ""}
											</p>
										</div>
										<span
											className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${MEMBERSHIP_TONE_BADGE_STYLES[display.tone]}`}
										>
											{display.label}
										</span>
									</div>
									{coverageLabel(row.memberCapacity) && (
										<p className="mt-1 text-[var(--muted-foreground)] text-xs">
											{coverageLabel(row.memberCapacity)}
										</p>
									)}
								</div>
							);
						})}

						{history.length > 0 && (
							<div className="pt-1">
								<button
									type="button"
									onClick={() => setShowHistory((v) => !v)}
									className="text-[var(--muted-foreground)] text-xs underline-offset-2 hover:underline"
								>
									{showHistory ? "Hide history" : "Show history"} (
									{history.length})
								</button>
								{showHistory && (
									<div className="mt-2 space-y-2">
										{history.map((row) => renderRow(row, true))}
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			{sellOpen && (
				<SellMembershipModal
					userId={userId}
					memberName={memberName}
					onClose={() => setSellOpen(false)}
					onSold={() => {
						void utils.memberships.listForMember.invalidate({ userId });
					}}
				/>
			)}

			{/* Remark-collecting confirmation (freeze/suspend/cancel/void) */}
			<AlertDialog
				open={remarkTarget !== null}
				title={remarkCopy?.title ?? ""}
				description={remarkCopy?.description ?? ""}
				destructive={remarkCopy?.destructive ?? false}
				confirmLabel={
					remarkActionPending ? "Working…" : (remarkCopy?.confirm ?? "Confirm")
				}
				cancelLabel="Cancel"
				confirmDisabled={remark.trim().length === 0 || remarkActionPending}
				onConfirm={confirmRemarkAction}
				onCancel={() => {
					if (remarkActionPending) return;
					setRemarkTarget(null);
				}}
			>
				<div className="space-y-1">
					<label
						htmlFor="membership-action-remark"
						className="font-medium text-[var(--foreground)] text-xs"
					>
						Remark <span className="text-red-500">*</span>
					</label>
					<textarea
						id="membership-action-remark"
						value={remark}
						onChange={(e) => setRemark(e.target.value)}
						rows={3}
						maxLength={2000}
						placeholder="Reason (required)"
						disabled={remarkActionPending}
						className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
					/>
				</div>
			</AlertDialog>
		</>
	);
}
