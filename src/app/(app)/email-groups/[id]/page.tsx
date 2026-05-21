import { Suspense } from "react";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import GroupDetailClient from "./GroupDetailClient";

export default async function GroupDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();
	const { id } = await params;

	return (
		<Suspense fallback={null}>
			<GroupDetailClient
				emailGroupId={id}
				userType={user.userType}
				userId={user.userId}
			/>
		</Suspense>
	);
}
