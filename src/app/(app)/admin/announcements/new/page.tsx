import { redirect } from "next/navigation";
import AnnouncementEditor from "~/app/_components/client/announcements/AnnouncementEditor";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";
import { api } from "~/trpc/server";

// Phase 15 Step 6 — New announcement page.
// Pre-fetches the clubs list for the scope dropdown (PLATFORM_ADMIN) AND to
// resolve clubShortName → clubName for the read-only "Publishing to ..." badge
// shown to non-admin staff.
export default async function NewAnnouncementPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	const clubs = await api.clubs.list();

	return (
		<AnnouncementEditor
			currentUser={{
				userId: user.userId,
				userType: user.userType,
				clubShortName: user.clubShortName,
				firstName: user.firstName,
				lastName: user.lastName,
			}}
			clubsAvailable={clubs}
		/>
	);
}
