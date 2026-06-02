import MembershipPlanForm from "~/app/(app)/admin/memberships/plans/MembershipPlanForm";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default async function EditMembershipPlanPage({
	params,
}: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return (
		<OnboardedGuard>
			<MembershipPlanForm mode="edit" membershipPlanId={id} />
		</OnboardedGuard>
	);
}
