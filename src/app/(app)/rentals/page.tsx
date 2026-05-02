import { Suspense } from "react";
import RentalsClient from "~/app/(app)/rentals/RentalsClient";

export default function RentalsPage() {
	return (
		<Suspense fallback={null}>
			<RentalsClient />
		</Suspense>
	);
}
