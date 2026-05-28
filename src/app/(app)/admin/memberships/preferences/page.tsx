import MembershipPreferencesClient from "~/app/(app)/admin/memberships/preferences/MembershipPreferencesClient";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default function MembershipPreferencesPage() {
	return (
		<OnboardedGuard>
			<MembershipPreferencesClient />
		</OnboardedGuard>
	);
}
