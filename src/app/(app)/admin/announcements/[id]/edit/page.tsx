import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";
import AnnouncementEditor from "~/app/_components/client/announcements/AnnouncementEditor";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";
import { api } from "~/trpc/server";

// Phase 15 Step 6 — Edit announcement page.
//
// Per Q10 (collaborative edit), there is NO per-author readonly fallback for
// announcements — any staff in the announcement's club can edit. The only
// "unauthorized" case is cross-club, and the router collapses that to
// NOT_FOUND (don't leak existence). So we just notFound() on TRPC NOT_FOUND;
// no read-only redirect path needed.
export default async function EditAnnouncementPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();

	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	const { id } = await params;

	let initial: Awaited<
		ReturnType<typeof api.announcements.adminGetById>
	> | null = null;
	try {
		initial = await api.announcements.adminGetById({ id });
	} catch (err) {
		if (err instanceof TRPCError && err.code === "NOT_FOUND") {
			notFound();
		}
		throw err;
	}
	if (!initial) notFound();

	// Always pass the clubs list — used to resolve clubShortName → clubName
	// for the read-only "Published to ..." badge.
	const clubs = await api.clubs.list();

	return (
		<AnnouncementEditor
			initial={initial}
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
