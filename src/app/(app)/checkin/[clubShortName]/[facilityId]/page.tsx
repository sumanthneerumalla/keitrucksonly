import CheckinClient from "./CheckinClient";

export default async function CheckinPage({
	params,
}: {
	params: Promise<{ clubShortName: string; facilityId: string }>;
}) {
	const { clubShortName, facilityId } = await params;
	return (
		<CheckinClient clubShortName={clubShortName} facilityId={facilityId} />
	);
}
