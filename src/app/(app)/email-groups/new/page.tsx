import { Suspense } from "react";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import CreateGroupClient from "./CreateGroupClient";

export default async function NewEmailGroupPage() {
	const user = await getOnboardedUserOrRedirect();

	return (
		<Suspense fallback={null}>
			<CreateGroupClient
				userType={user.userType}
				userId={user.userId}
				clubShortName={user.clubShortName}
				activeFacilityId={user.activeFacilityId}
			/>
		</Suspense>
	);
}
