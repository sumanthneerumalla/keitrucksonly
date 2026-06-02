import { redirect } from "next/navigation";
import ArticleList from "~/app/_components/client/articles/ArticleList";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";

export default async function AdminArticlesPage() {
	const user = await getOnboardedUserOrRedirect();

	// Phase 15 Stage 2 (Q1): coaches can author club articles, so they need
	// the admin list too. Gate widened from PLATFORM_ADMIN to staff-or-above.
	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	return (
		<ArticleList
			currentUser={{
				userId: user.userId,
				userType: user.userType,
				clubShortName: user.clubShortName,
			}}
		/>
	);
}
