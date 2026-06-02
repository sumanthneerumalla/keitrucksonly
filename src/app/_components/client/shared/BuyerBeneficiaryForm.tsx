"use client";

/**
 * Phase 12a Round 3 Stream 6 — shared pre-Stripe identity-capture form.
 *
 * Implements designFiles/roadmap/phase12-stripe-connect.md §7.8.2 mockup for
 * all four paid checkout-form pages (package / event / rental / membership).
 *
 * Locked decisions reflected here:
 *   - §7.8.2 (Option B URLs): this component is the MIDDLE stage of the three
 *     URLs (shop → checkout-form → /checkout/[sessionId]). On submit it pushes
 *     to `/checkout/[checkoutSessionId]` so the Stripe iframe mounts there.
 *   - §7.8.3 STRICT email normalization (lowercase + trim) at submit time.
 *     Server-side does the same in `normalizeIdentityBlock` — defense-in-depth.
 *   - §7.8.11 E1 — email is REQUIRED in the beneficiary block. No email-less
 *     kid path. The form's submit handler refuses an empty email.
 *   - §7.8.11 E2 — for logged-in members the payer block is read-only
 *     (rendered from the viewer's account; the radio "Me" path collapses it).
 *   - §7.8.10 Privacy — we never surface "this email exists in our system"
 *     hints. Submit-side errors come straight from the tRPC mutation.
 *
 * Logged-in family typeahead (E6): the design expects a typeahead of existing
 * family members for logged-in viewers. Stream 6 was instructed (per brief)
 * to either reuse an existing query or default to "Me" if no member-facing
 * query exists. There is no `family.getMyFamilyMembers` procedure today
 * (the existing `user.getFamilyGroup` is `facilityProcedure` — staff only),
 * and Round 3 explicitly excludes adding new `payments.*` endpoints. So v1
 * shows only the "+ Add new person" path under "Someone else" with manual
 * first/last/email inputs. Adding a member-callable family-listing endpoint
 * is captured as a follow-up.
 */

import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

/**
 * The subset of `payments.startCheckout.*` mutation names this form knows
 * how to wire to. The auth-vs-guest branching picks one of the two at submit
 * time. Stays a string literal union so the tRPC client's typed surface
 * tells us at compile time when a name drifts.
 */
export type CheckoutAuthEndpoint =
	| "package"
	| "event"
	| "rental"
	| "membership";
export type CheckoutGuestEndpoint =
	| "packageGuest"
	| "eventGuest"
	// Rental + membership are auth-only by design (no guest paths in router).
	| null;

interface BuyerBeneficiaryFormProps {
	itemKind: "package" | "event" | "rental" | "membership";
	itemId: string;
	clubShortName: string;
	pricing: { amountInCents: number; description: string };
	submitTo: CheckoutAuthEndpoint;
	submitToGuest: CheckoutGuestEndpoint;
}

type Mode = "self" | "other";

interface IdentityFields {
	firstName: string;
	lastName: string;
	email: string;
}

const emptyIdentity: IdentityFields = {
	firstName: "",
	lastName: "",
	email: "",
};

// §7.8.3 — lowercase + trim. Nothing else.
function normalizeEmail(input: string): string {
	return input.trim().toLowerCase();
}

// Cheap-and-cheerful email validator; the server's `z.string().email()` is
// the authoritative one. We just gate the Submit button + surface a friendly
// inline message.
function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function BuyerBeneficiaryForm({
	itemKind,
	itemId,
	clubShortName,
	pricing,
	submitTo,
	submitToGuest,
}: BuyerBeneficiaryFormProps) {
	const router = useRouter();
	const { toast } = useToast();
	const { isLoaded, isSignedIn } = useAuth();
	const { user: clerkUser } = useUser();

	const [mode, setMode] = useState<Mode>("self");
	const [beneficiary, setBeneficiary] = useState<IdentityFields>(emptyIdentity);
	const [payer, setPayer] = useState<IdentityFields>(emptyIdentity);
	const [submitting, setSubmitting] = useState(false);

	// Logged-in viewer's read-only "Your info (for the receipt)" block. Comes
	// from Clerk (the source of truth for auth identity) per §7.8.11 E2 —
	// payer email never editable for logged-in members.
	const viewerIdentity: IdentityFields | null = useMemo(() => {
		if (!clerkUser) return null;
		const email = clerkUser.primaryEmailAddress?.emailAddress ?? "";
		return {
			firstName: clerkUser.firstName ?? "",
			lastName: clerkUser.lastName ?? "",
			email,
		};
	}, [clerkUser]);

	// ----- tRPC mutations (one per possible endpoint; we call the one that
	// matches the current auth state at submit time). React-query rules require
	// hooks at the top level, so we declare both and pick at submit time. -----
	const startPackage = api.payments.startCheckout.package.useMutation();
	const startPackageGuest =
		api.payments.startCheckout.packageGuest.useMutation();
	const startEvent = api.payments.startCheckout.event.useMutation();
	const startEventGuest = api.payments.startCheckout.eventGuest.useMutation();
	const startRental = api.payments.startCheckout.rental.useMutation();
	const startMembership = api.payments.startCheckout.membership.useMutation();

	const showRadio = true; // Both authed and guest paths show the radio.
	const showBeneficiaryBlock = mode === "other";
	const showPayerBlock = !isSignedIn && mode === "other"; // Guest only.

	// §7.8.11 E1 — beneficiary email REQUIRED. Form disables submit until it's
	// present + a syntactically reasonable email.
	const beneficiaryValid =
		!showBeneficiaryBlock ||
		(beneficiary.firstName.trim().length > 0 &&
			isValidEmail(beneficiary.email));
	const payerValid =
		!showPayerBlock ||
		(payer.firstName.trim().length > 0 && isValidEmail(payer.email));
	// For an unauthed visitor in "Me" mode we still need their payer info — the
	// shop guest path's beneficiary IS the payer.
	const guestSelfValid =
		!isSignedIn && mode === "self"
			? payer.firstName.trim().length > 0 && isValidEmail(payer.email)
			: true;
	const canSubmit =
		!submitting && beneficiaryValid && payerValid && guestSelfValid;

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		setSubmitting(true);

		// Build the two-identity blocks per the §7.8.2 truth table. Normalize
		// emails at the boundary so any same-email dedup that fires server-side
		// (§7.8.5) lines up with what the user actually typed.
		const beneficiaryBlock =
			mode === "other"
				? {
						firstName: beneficiary.firstName.trim(),
						lastName: beneficiary.lastName.trim(),
						email: normalizeEmail(beneficiary.email),
					}
				: undefined;
		const payerBlock = isSignedIn
			? undefined // Logged-in: server uses the viewer's account row.
			: mode === "other"
				? {
						firstName: payer.firstName.trim(),
						lastName: payer.lastName.trim(),
						email: normalizeEmail(payer.email),
					}
				: // "Me" + guest: the buyer is also the beneficiary — single identity.
					{
						firstName: payer.firstName.trim(),
						lastName: payer.lastName.trim(),
						email: normalizeEmail(payer.email),
					};

		try {
			let result: { checkoutSessionId: string; clientSecret: string };

			if (isSignedIn) {
				// Auth path: one of four `startCheckout.*` mutations. Always pass
				// the (optional) beneficiary block; payer block stays unset (the
				// server resolves payer from `ctx.user`).
				if (submitTo === "package") {
					result = await startPackage.mutateAsync({
						packagePlanId: itemId,
						beneficiary: beneficiaryBlock,
					});
				} else if (submitTo === "event") {
					result = await startEvent.mutateAsync({
						eventId: itemId,
						beneficiary: beneficiaryBlock,
					});
				} else if (submitTo === "rental") {
					result = await startRental.mutateAsync({
						rentalBookingId: itemId,
						beneficiary: beneficiaryBlock,
					});
				} else {
					result = await startMembership.mutateAsync({
						membershipPlanId: itemId,
						beneficiary: beneficiaryBlock,
					});
				}
			} else {
				// Guest path: only package + event are exposed (rental/membership
				// require an auth context). If the page handed us a guest endpoint
				// of `null` we redirect the visitor to sign-in instead.
				if (submitToGuest === null) {
					toast("You need to sign in to complete this purchase.", "info");
					router.push("/sign-in");
					return;
				}
				if (submitToGuest === "packageGuest") {
					result = await startPackageGuest.mutateAsync({
						clubShortName,
						packagePlanId: itemId,
						beneficiary: beneficiaryBlock,
						payer: payerBlock,
					});
				} else {
					result = await startEventGuest.mutateAsync({
						clubShortName,
						eventId: itemId,
						beneficiary: beneficiaryBlock,
						payer: payerBlock,
					});
				}
			}

			router.push(`/checkout/${result.checkoutSessionId}`);
		} catch (err) {
			// Generic message — §7.8.10 privacy: we never lean into "this email
			// already exists" / "did you mean?" hints from server errors.
			const message =
				err instanceof Error
					? err.message
					: "Could not start checkout. Please try again.";
			toast(message, "error");
			setSubmitting(false);
		}
	}

	// Wait for Clerk to load so we don't flicker between authed/guest layouts.
	if (!isLoaded) {
		return (
			<div className="space-y-4">
				<div className="h-12 w-full animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-32 w-full animate-pulse rounded bg-[var(--muted)]" />
			</div>
		);
	}

	const itemLabelForRadio = (() => {
		switch (itemKind) {
			case "package":
				return "package";
			case "event":
				return "event registration";
			case "rental":
				return "booking";
			case "membership":
				return "membership";
		}
	})();

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* Summary box */}
			<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
				<div className="flex items-baseline justify-between gap-4">
					<div className="text-[var(--foreground)] text-sm">
						{pricing.description}
					</div>
					<div className="font-mono font-semibold text-[var(--foreground)] text-lg">
						{formatCents(pricing.amountInCents)}
					</div>
				</div>
			</div>

			{/* "Who's this for?" radio */}
			{showRadio && (
				<fieldset className="space-y-2">
					<legend className="font-medium text-[var(--foreground)] text-sm">
						{`Who's this ${itemLabelForRadio} for?`}
					</legend>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							name="who-for"
							checked={mode === "self"}
							onChange={() => setMode("self")}
							className="h-4 w-4"
						/>
						<span>Me{!isSignedIn ? " (I'm buying it for myself)" : ""}</span>
					</label>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							name="who-for"
							checked={mode === "other"}
							onChange={() => setMode("other")}
							className="h-4 w-4"
						/>
						<span>Someone else</span>
					</label>
				</fieldset>
			)}

			{/* Beneficiary block — appears only when mode = "other". For guests
			    this is a free-text identity capture; for logged-in members we
			    expose the same "Add new person" inputs (no typeahead in v1 per
			    the brief). */}
			{showBeneficiaryBlock && (
				<fieldset className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
					<legend className="px-1 font-medium text-[var(--foreground)] text-sm">
						Beneficiary{" "}
						<span className="font-normal text-[var(--muted-foreground)] text-xs">
							(the person using the credits / attending)
						</span>
					</legend>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1">
							<label
								htmlFor="bbf-beneficiary-first"
								className="text-[var(--muted-foreground)] text-xs"
							>
								First name
							</label>
							<Input
								id="bbf-beneficiary-first"
								type="text"
								required
								autoComplete="given-name"
								value={beneficiary.firstName}
								onChange={(e) =>
									setBeneficiary({ ...beneficiary, firstName: e.target.value })
								}
							/>
						</div>
						<div className="space-y-1">
							<label
								htmlFor="bbf-beneficiary-last"
								className="text-[var(--muted-foreground)] text-xs"
							>
								Last name
							</label>
							<Input
								id="bbf-beneficiary-last"
								type="text"
								autoComplete="family-name"
								value={beneficiary.lastName}
								onChange={(e) =>
									setBeneficiary({ ...beneficiary, lastName: e.target.value })
								}
							/>
						</div>
					</div>
					<div className="space-y-1">
						<label
							htmlFor="bbf-beneficiary-email"
							className="text-[var(--muted-foreground)] text-xs"
						>
							Email <span className="text-[var(--destructive)]">*</span>
						</label>
						<Input
							id="bbf-beneficiary-email"
							type="email"
							required
							autoComplete="email"
							value={beneficiary.email}
							onChange={(e) =>
								setBeneficiary({ ...beneficiary, email: e.target.value })
							}
						/>
					</div>
				</fieldset>
			)}

			{/* Payer block — guest-mode only gets editable inputs; logged-in
			    members get a read-only display of their own Clerk identity. */}
			{isSignedIn ? (
				viewerIdentity && (
					<fieldset className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
						<legend className="px-1 font-medium text-[var(--foreground)] text-sm">
							Your info{" "}
							<span className="font-normal text-[var(--muted-foreground)] text-xs">
								(for the receipt)
							</span>
						</legend>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							<dt className="text-[var(--muted-foreground)] text-xs">Name</dt>
							<dd className="text-[var(--foreground)]">
								{`${viewerIdentity.firstName} ${viewerIdentity.lastName}`.trim() ||
									"—"}
							</dd>
							<dt className="text-[var(--muted-foreground)] text-xs">Email</dt>
							<dd className="text-[var(--foreground)]">
								{viewerIdentity.email || "—"}
							</dd>
						</dl>
						<p className="text-[var(--muted-foreground)] text-xs">
							Read-only. Update your profile if this needs to change.
						</p>
					</fieldset>
				)
			) : (
				<fieldset className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
					<legend className="px-1 font-medium text-[var(--foreground)] text-sm">
						{mode === "other" ? "Your info (for the receipt)" : "Your info"}
					</legend>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1">
							<label
								htmlFor="bbf-payer-first"
								className="text-[var(--muted-foreground)] text-xs"
							>
								First name
							</label>
							<Input
								id="bbf-payer-first"
								type="text"
								required
								autoComplete="given-name"
								value={payer.firstName}
								onChange={(e) =>
									setPayer({ ...payer, firstName: e.target.value })
								}
							/>
						</div>
						<div className="space-y-1">
							<label
								htmlFor="bbf-payer-last"
								className="text-[var(--muted-foreground)] text-xs"
							>
								Last name
							</label>
							<Input
								id="bbf-payer-last"
								type="text"
								autoComplete="family-name"
								value={payer.lastName}
								onChange={(e) =>
									setPayer({ ...payer, lastName: e.target.value })
								}
							/>
						</div>
					</div>
					<div className="space-y-1">
						<label
							htmlFor="bbf-payer-email"
							className="text-[var(--muted-foreground)] text-xs"
						>
							Email <span className="text-[var(--destructive)]">*</span>
						</label>
						<Input
							id="bbf-payer-email"
							type="email"
							required
							autoComplete="email"
							value={payer.email}
							onChange={(e) => setPayer({ ...payer, email: e.target.value })}
						/>
					</div>
				</fieldset>
			)}

			{/* Inline notice — §7.8.2 verbatim copy + the §7.8.11 E1 nudge. */}
			<p className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-[var(--muted-foreground)] text-xs">
				We'll create accounts for both of you if you don't already have one. To
				add this purchase to an existing account, the email must match exactly.
				If your child doesn't have their own email yet, contact your club to set
				up their account first.
			</p>

			<div className="flex justify-end">
				<Button type="submit" size="lg" disabled={!canSubmit}>
					{submitting ? "Starting checkout…" : "Continue to payment →"}
				</Button>
			</div>
		</form>
	);
}
