import MembershipPlanForm from "~/app/(app)/admin/memberships/plans/MembershipPlanForm";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default function NewMembershipPlanPage() {
	return (
		<OnboardedGuard>
			<MembershipPlanForm mode="create" />
		</OnboardedGuard>
	);
}
