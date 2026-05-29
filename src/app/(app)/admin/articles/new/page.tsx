import { redirect } from "next/navigation";
import ArticleEditor from "~/app/_components/client/articles/ArticleEditor";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";
import { api } from "~/trpc/server";

export default async function NewArticlePage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	// Server-fetch the clubs list for the scope dropdown. Only PLATFORM_ADMIN
	// renders the dropdown, but we always pass the list so non-admins can
	// resolve their own clubName for the read-only "Publishing as ..." badge.
	const clubs = await api.clubs.list();

	return (
		<ArticleEditor
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
