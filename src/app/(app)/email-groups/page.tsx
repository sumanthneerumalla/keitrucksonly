import { Suspense } from "react";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import EmailGroupsClient from "./EmailGroupsClient";

export default async function EmailGroupsPage() {
	const user = await getOnboardedUserOrRedirect();

	return (
		<Suspense fallback={null}>
			<EmailGroupsClient
				userType={user.userType}
				userId={user.userId}
				clubShortName={user.clubShortName}
				activeFacilityId={user.activeFacilityId}
			/>
		</Suspense>
	);
}
