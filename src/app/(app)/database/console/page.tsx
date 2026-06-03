import { AdminGuard } from "~/app/_components/server/AdminGuard";
import SqlConsole from "./SqlConsole";

export default function DatabaseConsolePage() {
	return (
		<AdminGuard>
			<SqlConsole />
		</AdminGuard>
	);
}
