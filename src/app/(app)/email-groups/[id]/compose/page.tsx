import { Suspense } from "react";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import ComposeEmailClient from "./ComposeEmailClient";

export default async function ComposeEmailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();
	const { id } = await params;

	return (
		<Suspense fallback={null}>
			<ComposeEmailClient
				emailGroupId={id}
				userType={user.userType}
				userId={user.userId}
			/>
		</Suspense>
	);
}
