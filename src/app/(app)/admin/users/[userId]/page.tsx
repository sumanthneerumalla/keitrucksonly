import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/lib/utils";
import StudentDetailClient from "./StudentDetailClient";

export default async function StudentDetailPage({
	params,
}: {
	params: Promise<{ userId: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
		redirect("/dashboard");
	}

	const { userId } = await params;

	return <StudentDetailClient userId={userId} />;
}
