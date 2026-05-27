import {
	type InvoiceAudience,
	type InvoiceStatusInput,
	type InvoiceStatusTone,
	invoiceStatusDisplay,
} from "~/lib/invoiceStatus";

/**
 * Phase 9a — the invoice status pill, rendered from the single-source
 * `invoiceStatusDisplay` helper. Colors key off the DERIVED tone (not the
 * stored status) so "Paid"/"Credit" share success-green, "Due" warns amber,
 * open/partially-paid tabs read neutral blue, and void/draft sit muted.
 *
 * Returns null when the label is empty (a void invoice for a member audience),
 * matching the "hidden from member" contract.
 */
const TONE_PILL_STYLES: Record<InvoiceStatusTone, string> = {
	success:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
	warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
	neutral: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	muted: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

export function InvoiceStatusPill({
	inv,
	audience,
	className,
}: {
	inv: InvoiceStatusInput;
	audience: InvoiceAudience;
	className?: string;
}) {
	const display = invoiceStatusDisplay(inv, audience);
	if (!display.label) return null;
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${TONE_PILL_STYLES[display.tone]} ${className ?? ""}`}
		>
			{display.label}
		</span>
	);
}
