/**
 * Single source of truth for how an invoice's state is LABELLED in the UI
 * (Phase 9a status spec). The stored `Invoice.status` is only one axis
 * (draft | open | partially_paid | paid | void); the lifecycle ("is this tab
 * still open, or has staff marked it due?") lives on `closedAt`; and the
 * money sign lives on the balance. We derive a single human label from all of
 * them so the word "Closed" never leaks to users.
 *
 * Per the product decision (2026-05-21), the signed balance amount is baked
 * INTO the label (not just shown in a separate column), and member/staff get
 * distinct wording:
 *
 *   condition                              member                     staff
 *   --------------------------------------------------------------------------
 *   paid                                   "Paid"                     "Paid"
 *   overpaid (balance < 0)                 "Account credit $X"        "Credit $X"
 *   marked due (closedAt set) + owes       "Amount due $X"            "Due · $X"
 *   partially paid, still an open tab      "Partially paid · $X due"  "Open tab · partially paid"
 *   open tab, nothing marked due yet       "Current balance $X"       "Open tab · $X"
 *   void                                   (hidden)                   "Voided"
 *
 * ($X is formatted via formatCents; the staff "Open tab · partially paid" row
 * intentionally omits the amount per the approved spec.)
 *
 * NOTE on overdue: today "Mark as due" sets `dueDate = now` and there are no
 * penalties, so "Due" and "Overdue" collapse — we show "Due". The derive logic
 * is kept ready: when real payment terms make `dueDate` a future date, a
 * separate "Overdue" (dueDate < now && balance > 0) can split off here without
 * touching callers. `overdue` is NOT a stored status.
 */

import { formatCents } from "~/lib/money";

export type InvoiceAudience = "member" | "staff";

export type InvoiceStatusTone = "neutral" | "warn" | "success" | "muted";

export interface InvoiceStatusInput {
	/** Stored status: draft | open | partially_paid | paid | void. */
	status: string;
	/** Set when the tab was marked due (or auto-closed on full payment). */
	closedAt: Date | string | null;
	/** Set when marked due. Reserved for future overdue/terms logic. */
	dueDate: Date | string | null;
	/** Signed balance = totalInCents - amountPaidInCents (negative = credit). */
	balanceInCents: number;
}

export interface InvoiceStatusDisplay {
	/** Short label for a status pill. Empty string when hidden from the audience. */
	label: string;
	tone: InvoiceStatusTone;
	/** True when this invoice should not be shown to a member at all (void). */
	hiddenFromMember: boolean;
}

export function invoiceStatusDisplay(
	inv: InvoiceStatusInput,
	audience: InvoiceAudience,
): InvoiceStatusDisplay {
	const isMember = audience === "member";
	const bal = inv.balanceInCents;
	const isMarkedDue = inv.closedAt != null;
	// Amount owed (positive balance) vs credit held (absolute of negative balance).
	const owed = formatCents(bal);
	const creditAmount = formatCents(Math.abs(bal));

	if (inv.status === "void") {
		return {
			label: isMember ? "" : "Voided",
			tone: "muted",
			hiddenFromMember: true,
		};
	}

	// Forward guard: no UI produces drafts today, but show neutrally if one appears.
	if (inv.status === "draft") {
		return { label: "Draft", tone: "muted", hiddenFromMember: false };
	}

	// Overpayment surfaces as account credit (signed negative balance).
	if (bal < 0) {
		return {
			label: isMember
				? `Account credit ${creditAmount}`
				: `Credit ${creditAmount}`,
			tone: "success",
			hiddenFromMember: false,
		};
	}

	if (inv.status === "paid") {
		return { label: "Paid", tone: "success", hiddenFromMember: false };
	}

	// Not paid, balance >= 0.
	if (isMarkedDue && bal > 0) {
		// Staff marked the tab due (closedAt set) and a balance remains.
		// "Due" — never the bare word "Closed".
		return {
			label: isMember ? `Amount due ${owed}` : `Due · ${owed}`,
			tone: "warn",
			hiddenFromMember: false,
		};
	}

	if (inv.status === "partially_paid") {
		return {
			label: isMember
				? `Partially paid · ${owed} due`
				: "Open tab · partially paid",
			tone: "neutral",
			hiddenFromMember: false,
		};
	}

	// open tab, nothing marked due yet.
	return {
		label: isMember ? `Current balance ${owed}` : `Open tab · ${owed}`,
		tone: "neutral",
		hiddenFromMember: false,
	};
}
