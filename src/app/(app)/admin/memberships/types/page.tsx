import MembershipTypesClient from "~/app/(app)/admin/memberships/types/MembershipTypesClient";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default function MembershipTypesPage() {
	return (
		<OnboardedGuard>
			<MembershipTypesClient />
		</OnboardedGuard>
	);
}
