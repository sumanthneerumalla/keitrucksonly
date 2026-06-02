// Shared, presentation-only helper for summarizing a membership plan's billing
// cadence as a human-readable string (e.g. "every 1 month x 12" or
// "every 3 months, indefinite"). Used by the plans list table and the
// create/edit form preview so they always read the same. Period length =
// billingInterval + billingUnit; billingCycles (null) = indefinite contract.

interface BillingShape {
	billingInterval: number;
	billingUnit: string;
	billingCycles: number | null;
}

/** Pluralize a unit label by interval (1 month / 3 months). */
function unitLabel(unit: string, interval: number): string {
	return interval === 1 ? unit : `${unit}s`;
}

/** "every 1 month x 12" / "every 3 months, indefinite". */
export function formatBilling(plan: BillingShape): string {
	const cadence = `every ${plan.billingInterval} ${unitLabel(
		plan.billingUnit,
		plan.billingInterval,
	)}`;
	if (plan.billingCycles === null) {
		return `${cadence}, indefinite`;
	}
	return `${cadence} x ${plan.billingCycles}`;
}
