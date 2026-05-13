import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/server/utils/utils";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
		redirect("/admin");
	}

	return (
		<Suspense fallback={null}>
			<UsersClient userType={user.userType} clubShortName={user.clubShortName} />
		</Suspense>
	);
}
