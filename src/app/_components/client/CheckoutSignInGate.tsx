"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { useStashJoinIntent } from "~/app/_components/hooks/use-stash-join-intent";
import { Button } from "~/app/_components/shared/Button";

/**
 * Rendered by auth-required checkout pages (server components) when the visitor
 * isn't signed in. Stashes the club + return-to so a NEW buyer is onboarded via
 * /join (join club → profile) and a returning member is forwarded — both land
 * back on this checkout page. Replaces the old redirect to a non-existent
 * /sign-in route.
 */
export function CheckoutSignInGate({
	clubShortName,
	next,
}: {
	clubShortName: string;
	next: string;
}) {
	useStashJoinIntent({ clubShortName, next });
	return (
		<div className="mx-auto max-w-md space-y-4 p-6 text-center">
			<h1 className="font-semibold text-[var(--foreground)] text-xl">
				Sign in to continue
			</h1>
			<p className="text-[var(--muted-foreground)] text-sm">
				Sign in or create an account to complete your purchase.
			</p>
			<SignInButton
				mode="modal"
				forceRedirectUrl="/join"
				signUpForceRedirectUrl="/join"
			>
				<Button className="min-w-[200px]">Sign in</Button>
			</SignInButton>
			<div>
				<Button asChild variant="outline" size="sm">
					<Link href={`/club/${clubShortName}/shop`}>Back to shop</Link>
				</Button>
			</div>
		</div>
	);
}
