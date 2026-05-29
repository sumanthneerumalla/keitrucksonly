import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";
import ArticleEditor from "~/app/_components/client/articles/ArticleEditor";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";
import { api } from "~/trpc/server";

export default async function EditArticlePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();

	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	const { id } = await params;

	let initial: Awaited<ReturnType<typeof api.articles.adminGetById>> | null =
		null;
	try {
		initial = await api.articles.adminGetById({ id });
	} catch (err) {
		if (err instanceof TRPCError && err.code === "NOT_FOUND") {
			notFound();
		}
		throw err;
	}
	if (!initial) notFound();

	// Phase 15 fixup F2: unauthorized callers (per-author rule, Q9) must be
	// redirected away from the editor, not shown a read-only TipTap (lost-work
	// trap). Send them to the public reading surface when one exists, else to
	// the admin list with a notice query param (toast wiring is a future pass).
	if (!initial.canEdit) {
		if (initial.status === "PUBLISHED" && initial.clubShortName === null) {
			redirect(`/articles/${initial.slug}`);
		}
		if (initial.status === "PUBLISHED" && initial.clubShortName !== null) {
			// TODO: replace with `/<short>/articles/<slug>` once Step 4 (club
			// public pages) ships. For now, defer to the admin list with a
			// notice indicating the public surface isn't built yet.
			redirect("/admin/articles?notice=read-via-public");
		}
		// DRAFT — should be rare since Q11 hides other authors' drafts from
		// the list; this is defense-in-depth for direct-URL access.
		redirect("/admin/articles?notice=no-edit-access");
	}

	// For existing posts the scope is locked, but the editor still needs the
	// clubs list to resolve the post's clubShortName → clubName for the
	// read-only badge.
	const clubs = await api.clubs.list();

	return (
		<ArticleEditor
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
