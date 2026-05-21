import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/server/utils/utils";
import ClientsList from "./ClientsList";

export default async function ClientsPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
		redirect("/dashboard");
	}

	return (
		<Suspense fallback={null}>
			<ClientsList userType={user.userType} clubShortName={user.clubShortName} />
		</Suspense>
	);
}
