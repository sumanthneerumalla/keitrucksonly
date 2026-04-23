import RentalWindowsClient from "~/app/(app)/admin/rentals/RentalWindowsClient";
import { OnboardedGuard } from "~/app/_components/server/OnboardedGuard";

export default function AdminRentalsPage() {
	return (
		<OnboardedGuard>
			<RentalWindowsClient />
		</OnboardedGuard>
	);
}
