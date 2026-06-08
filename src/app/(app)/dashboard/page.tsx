import { redirect } from "next/navigation";

// The dashboard was replaced by /home (the sidebar item now points there). Keep
// this route as a redirect so old links / bookmarks still land somewhere useful.
// DashboardClient.tsx is left in place but unused.
export default function DashboardPage() {
	redirect("/home");
}
