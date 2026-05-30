"use client";

import { History } from "lucide-react";
import { Button } from "~/app/_components/shared/Button";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

/**
 * Phase 9a — Activity timeline for a member's BillingPanel Activity tab.
 * Reads from `billing.listMemberActivity` (paginated AuditLog rows where the
 * viewed member is the target). Bill-to actions emit one row per affected
 * party with a different `targetUserId`, so the query naturally returns at
 * most one row per action that involved this member — no client-side
 * collapsing needed for the per-member surface.
 *
 * Designed to fit inside an existing card (no surrounding chrome) — the
 * caller (BillingPanel's Activity tab) provides the heading and spacing.
 */

interface MemberActivityTimelineProps {
	userId: string;
}

const ACTION_LABELS: Record<string, string> = {
	// Phase 9 — invoicing
	"package.sold": "Package sold",
	"payment.recorded": "Payment recorded",
	"account_credit.applied": "Account credit applied",
	"invoice.marked_due": "Invoice marked due",
	"invoice.voided": "Invoice voided",
	"refund.issued": "Refund issued",
	// Phase 9a — additional charge sources
	"charge.adhoc": "Charge added",
	"charge.event_registration": "Event charge",
	// Phase 10a — memberships
	"membership.sold": "Membership sold",
	"membership.frozen": "Membership frozen",
	"membership.unfrozen": "Membership unfrozen",
	"membership.suspended": "Membership suspended",
	"membership.reinstated": "Membership reinstated",
	"membership.cancelled": "Membership cancelled",
	"membership.voided": "Membership voided",
	// Phase 12a — Stripe Connect (here for completeness; targetUser is rarely
	// the member for these actions, but include the label so anything that
	// does target them reads cleanly).
	"stripe_account.connected": "Stripe account connected",
	"stripe_account.disconnected": "Stripe account disconnected",
	"stripe_account.updated": "Stripe account updated",
	"checkout.started": "Checkout started",
	"checkout.completed": "Checkout completed",
	"orphan.resolved": "Orphan resolved",
};

function formatTimestamp(d: Date | string): string {
	return new Date(d).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatPersonName(p: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "(no name)";
}

// Pull a few common metadata fields out for the row subline. Missing keys
// just don't render — the JSON shape varies per action.
function extractDetail(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const m = metadata as Record<string, unknown>;
	const amount =
		typeof m.amountInCents === "number"
			? m.amountInCents
			: typeof m.lineTotalInCents === "number"
				? m.lineTotalInCents
				: typeof m.appliedInCents === "number"
					? m.appliedInCents
					: null;
	if (amount !== null) return formatCents(amount);
	// Event-title fallback for event-registration charges.
	if (typeof m.eventTitle === "string" && m.eventTitle.trim() !== "") {
		return m.eventTitle;
	}
	return null;
}

export default function MemberActivityTimeline({
	userId,
}: MemberActivityTimelineProps) {
	const query = api.billing.listMemberActivity.useInfiniteQuery(
		{ userId, limit: 50 },
		{
			getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		},
	);

	if (query.isLoading) {
		return (
			<div className="space-y-3 py-2">
				<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
			</div>
		);
	}

	if (query.isError) {
		return (
			<p className="py-2 text-[var(--muted-foreground)] text-xs">
				Couldn't load activity. {query.error.message}
			</p>
		);
	}

	const allRows = query.data?.pages.flatMap((p) => p.items) ?? [];

	if (allRows.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] border-dashed py-10 text-center">
				<History size={18} className="mb-2 text-[var(--muted-foreground)]" />
				<p className="text-[var(--muted-foreground)] text-sm">
					No billing activity yet for this member.
				</p>
			</div>
		);
	}

	return (
		<div>
			<ul className="divide-y divide-[var(--border)]">
				{allRows.map((row) => {
					const label = ACTION_LABELS[row.action] ?? row.action;
					const actor = row.actorUser
						? formatPersonName(row.actorUser)
						: row.source === "cron"
							? "System (cron)"
							: row.source === "webhook"
								? "System (webhook)"
								: row.source === "system"
									? "System"
									: null;
					const detail = extractDetail(row.metadata);
					return (
						<li key={row.logId} className="py-3 first:pt-0">
							<div className="flex items-baseline justify-between gap-3">
								<span className="font-medium text-[var(--foreground)] text-sm">
									{label}
								</span>
								<span className="shrink-0 text-[var(--muted-foreground)] text-xs">
									{formatTimestamp(row.createdAt)}
								</span>
							</div>
							<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[var(--muted-foreground)] text-xs">
								{actor && <span>by {actor}</span>}
								{detail && (
									<>
										<span aria-hidden>·</span>
										<span className="font-mono">{detail}</span>
									</>
								)}
								{row.targetRole === "payer" && (
									<>
										<span aria-hidden>·</span>
										<span>billed to this member</span>
									</>
								)}
							</div>
						</li>
					);
				})}
			</ul>
			{query.hasNextPage && (
				<div className="mt-4 flex justify-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => query.fetchNextPage()}
						disabled={query.isFetchingNextPage}
					>
						{query.isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}
		</div>
	);
}
