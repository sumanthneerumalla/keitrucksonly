import WindowBookingsClient from "~/app/(app)/admin/rentals/[windowId]/WindowBookingsClient";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default function WindowBookingsPage() {
	return (
		<OnboardedGuard>
			<WindowBookingsClient />
		</OnboardedGuard>
	);
}
