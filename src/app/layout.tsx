import "~/styles/globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-jbm",
	display: "swap",
});

export const metadata: Metadata = {
	title: "Facility Presence",
	description:
		"All-in-one facility management platform for sports and recreation",
	// Favicons are provided by the App Router file conventions: app/icon.svg
	// (modern, scalable), app/icon.png (raster fallback), app/apple-icon.png.
	// Next injects the <link> tags automatically — no manual config needed.
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
			<body className="font-sans antialiased">{children}</body>
		</html>
	);
}
