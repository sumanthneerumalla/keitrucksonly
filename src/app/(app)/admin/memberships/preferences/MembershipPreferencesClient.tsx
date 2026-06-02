"use client";

import { useEffect, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Membership Preferences — club-level settings screen (Phase 10a —
// phase10-memberships.md "Membership Preferences (Club-Level Settings)").
// Stored as a JSON bag on the Club model; read/written via
// memberships.getPreferences / updatePreferences.
//
// 10a IMPLEMENTS billingAnchorMode = "signup" (each member's term runs a full
// calendar period from their join day) and cancelRefundStrategy = "manual"
// (staff enter the refund amount). "calendar" anchor + first-term proration +
// auto-generated member numbers ship as inert config (shown disabled/future)
// so a club can enable them later without a migration.
//
// Access mirrors the catalog admin pages: club/platform admins only (isAnyAdmin).
// ---------------------------------------------------------------------------

type BillingAnchorMode = "signup" | "calendar";
type CancelRefundStrategy =
	| "manual"
	| "used_terms_at_base_rate"
	| "prorate_dropin";
type ProrationRounding = "nearest" | "up" | "down";

interface PreferencesState {
	requireRemarkForFreeze: boolean;
	requireRemarkForSuspend: boolean;
	requireRemarkForCancel: boolean;
	autoGenerateMemberNumbers: boolean;
	billingAnchorMode: BillingAnchorMode;
	billingAnchorDay: number | null;
	prorateFirstTerm: boolean;
	cancelRefundStrategy: CancelRefundStrategy;
	prorationRounding: ProrationRounding;
}

const DEFAULT_PREFERENCES: PreferencesState = {
	requireRemarkForFreeze: true,
	requireRemarkForSuspend: true,
	requireRemarkForCancel: true,
	autoGenerateMemberNumbers: false,
	billingAnchorMode: "signup",
	billingAnchorDay: null,
	prorateFirstTerm: false,
	cancelRefundStrategy: "manual",
	prorationRounding: "nearest",
};

export default function MembershipPreferencesClient() {
	const { toast } = useToast();
	const [prefs, setPrefs] = useState<PreferencesState>(DEFAULT_PREFERENCES);
	const [saving, setSaving] = useState(false);

	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	const { data: prefsData, isLoading } =
		api.memberships.getPreferences.useQuery();

	const utils = api.useUtils();

	// Hydrate from the server, falling back to defaults for any missing keys
	// (the JSON bag may predate a field, or be null on a fresh club).
	useEffect(() => {
		if (!prefsData?.preferences) return;
		setPrefs({ ...DEFAULT_PREFERENCES, ...prefsData.preferences });
	}, [prefsData]);

	const updateMutation = api.memberships.updatePreferences.useMutation({
		onSuccess: () => {
			void utils.memberships.getPreferences.invalidate();
			toast("Membership preferences saved", "success");
		},
		onError: (err) => toast(err.message, "error"),
		onSettled: () => setSaving(false),
	});

	const canManage = user ? isAnyAdmin(user) : false;

	const set = <K extends keyof PreferencesState>(
		key: K,
		value: PreferencesState[K],
	) => setPrefs((prev) => ({ ...prev, [key]: value }));

	const handleSave = () => {
		setSaving(true);
		// Only "signup" + "manual" are live in 10a; persist the rest as-is so the
		// inert future config round-trips unchanged.
		updateMutation.mutate(prefs);
	};

	if (isUserLoading || isLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	if (!canManage) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						Access Denied
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						Only club and platform admins can change membership preferences.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			{/* Header */}
			<div className="mb-6">
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					Membership Preferences
				</h1>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Club-wide settings for how memberships bill, freeze, and cancel.
				</p>
			</div>

			<div className="max-w-2xl space-y-8">
				{/* Required remarks */}
				<section className="space-y-3">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Required Remarks
					</h2>
					<p className="text-[var(--muted-foreground)] text-sm">
						Require staff to enter a reason when changing a membership's status.
					</p>
					<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--foreground)] text-sm">
						<input
							type="checkbox"
							checked={prefs.requireRemarkForFreeze}
							onChange={(e) => set("requireRemarkForFreeze", e.target.checked)}
							disabled={saving}
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Require a remark to freeze a membership
					</label>
					<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--foreground)] text-sm">
						<input
							type="checkbox"
							checked={prefs.requireRemarkForSuspend}
							onChange={(e) => set("requireRemarkForSuspend", e.target.checked)}
							disabled={saving}
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Require a remark to suspend a membership
					</label>
					<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--foreground)] text-sm">
						<input
							type="checkbox"
							checked={prefs.requireRemarkForCancel}
							onChange={(e) => set("requireRemarkForCancel", e.target.checked)}
							disabled={saving}
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Require a remark to cancel a membership
					</label>
				</section>

				{/* Billing anchor */}
				<section className="space-y-3">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Billing Anchor
					</h2>
					<div className="space-y-2">
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="radio"
								name="anchor"
								checked={prefs.billingAnchorMode === "signup"}
								onChange={() => set("billingAnchorMode", "signup")}
								className="mt-0.5"
								disabled={saving}
							/>
							<div>
								<div className="font-medium text-[var(--foreground)]">
									Signup-anchored
								</div>
								<p className="text-[var(--muted-foreground)] text-xs">
									Each member's term runs a full calendar period from their join
									day (e.g. Feb 15 &rarr; Mar 14). No mid-join proration.
								</p>
							</div>
						</label>
						<label className="flex cursor-not-allowed items-start gap-2 text-sm opacity-60">
							<input
								type="radio"
								name="anchor"
								checked={prefs.billingAnchorMode === "calendar"}
								disabled
								className="mt-0.5"
							/>
							<div>
								<div className="flex items-center gap-2 font-medium text-[var(--muted-foreground)]">
									Calendar-aligned
									<span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs">
										Coming soon
									</span>
								</div>
								<p className="text-[var(--muted-foreground)] text-xs">
									Everyone bills on a shared day of the month; mid-month signups
									are prorated for the first term. Not available yet.
								</p>
							</div>
						</label>
					</div>

					{/* Calendar-only sub-settings — shown disabled as future config. */}
					<div className="space-y-3 rounded-lg bg-[var(--muted)] p-4 opacity-60">
						<p className="text-[var(--muted-foreground)] text-xs">
							The settings below apply only to calendar-aligned billing (coming
							soon).
						</p>
						<div className="space-y-1">
							<label
								htmlFor="pref-billing-anchor-day"
								className="font-medium text-[var(--muted-foreground)] text-sm"
							>
								Billing day of month
							</label>
							<Input
								id="pref-billing-anchor-day"
								type="number"
								min={1}
								max={28}
								value={prefs.billingAnchorDay ?? ""}
								placeholder="e.g. 1"
								disabled
								className="w-32"
							/>
						</div>
						<label className="flex cursor-not-allowed select-none items-center gap-2 text-[var(--muted-foreground)] text-sm">
							<input
								type="checkbox"
								checked={prefs.prorateFirstTerm}
								disabled
								className="h-4 w-4 rounded border-input accent-[var(--primary)]"
							/>
							Prorate the first term for mid-cycle signups
						</label>
					</div>
				</section>

				{/* Cancellation refund */}
				<section className="space-y-3">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Cancellation Refund
					</h2>
					<div className="space-y-1">
						<label
							htmlFor="pref-cancel-refund-strategy"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Refund strategy
						</label>
						<Select
							id="pref-cancel-refund-strategy"
							value={prefs.cancelRefundStrategy}
							onChange={(e) =>
								set(
									"cancelRefundStrategy",
									e.target.value as CancelRefundStrategy,
								)
							}
							disabled={saving}
							className="h-9"
						>
							<option value="manual">
								Manual — staff enter the refund amount
							</option>
							<option value="used_terms_at_base_rate" disabled>
								Auto: used terms at base rate (coming soon)
							</option>
							<option value="prorate_dropin" disabled>
								Auto: prorate at drop-in rate (coming soon)
							</option>
						</Select>
						<p className="text-[var(--muted-foreground)] text-xs">
							In 10a, cancellations record a manually-entered refund amount.
							Automatic step-down calculation is coming soon.
						</p>
					</div>

					<div className="space-y-1 opacity-60">
						<label
							htmlFor="pref-proration-rounding"
							className="font-medium text-[var(--muted-foreground)] text-sm"
						>
							Proration rounding
						</label>
						<Select
							id="pref-proration-rounding"
							value={prefs.prorationRounding}
							onChange={(e) =>
								set("prorationRounding", e.target.value as ProrationRounding)
							}
							disabled
							className="h-9"
						>
							<option value="nearest">Nearest cent</option>
							<option value="up">Round up</option>
							<option value="down">Round down</option>
						</Select>
						<p className="text-[var(--muted-foreground)] text-xs">
							Applies to future automatic proration. Not used yet.
						</p>
					</div>
				</section>

				{/* Membership numbers */}
				<section className="space-y-3">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Membership Numbers
					</h2>
					<label className="flex cursor-not-allowed select-none items-center gap-2 text-[var(--muted-foreground)] text-sm opacity-60">
						<input
							type="checkbox"
							checked={prefs.autoGenerateMemberNumbers}
							disabled
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Auto-generate membership numbers
						<span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs">
							Coming soon
						</span>
					</label>
				</section>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t pt-4">
					<Button onClick={handleSave} disabled={saving}>
						{saving ? "Saving..." : "Save Preferences"}
					</Button>
				</div>
			</div>
		</div>
	);
}
