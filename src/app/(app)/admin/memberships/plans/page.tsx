import MembershipPlansClient from "~/app/(app)/admin/memberships/plans/MembershipPlansClient";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default function MembershipPlansPage() {
	return (
		<OnboardedGuard>
			<MembershipPlansClient />
		</OnboardedGuard>
	);
}
