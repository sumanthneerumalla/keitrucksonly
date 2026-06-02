import { redirect } from "next/navigation";
import AnnouncementList from "~/app/_components/client/announcements/AnnouncementList";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";

// Phase 15 Step 6 — Admin announcements index.
// Mirrors /admin/articles gating: staff-or-above (COACH/FACILITY/CLUB_ADMIN/
// PLATFORM_ADMIN). Authoring privileges are further enforced inside the
// router on a per-procedure basis.
export default async function AdminAnnouncementsPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	return (
		<AnnouncementList
			currentUser={{
				userId: user.userId,
				userType: user.userType,
				clubShortName: user.clubShortName,
			}}
		/>
	);
}
