import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isAnyAdmin } from "~/lib/utils";
import ClubSettingsClient from "./ClubSettingsClient";

export default async function ClubBrandingSettingsPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isAnyAdmin(user)) {
		redirect("/admin");
	}

	return <ClubSettingsClient />;
}
