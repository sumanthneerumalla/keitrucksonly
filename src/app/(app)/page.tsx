import type { Metadata } from "next";
import { B2BHomePage } from "~/app/_components/client/public/B2BHomePage";

export const metadata: Metadata = {
	title: "Facility Presence — One platform to run your courts",
	description:
		"Court calendar, self-serve check-in, packages, payments, and reports — under one roof, with one bill. Built for pickleball, tennis, and padel clubs.",
};

export default function Home() {
	return <B2BHomePage />;
}
