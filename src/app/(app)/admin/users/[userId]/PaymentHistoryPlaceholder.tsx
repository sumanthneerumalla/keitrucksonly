import { Receipt } from "lucide-react";

export default function PaymentHistoryPlaceholder() {
	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<h4 className="mb-2 flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
				<Receipt size={14} />
				Payment History
			</h4>
			<p className="text-[var(--muted-foreground)] text-xs">
				Payment tracking will appear here once invoicing ships (Phase 9).
			</p>
		</div>
	);
}
