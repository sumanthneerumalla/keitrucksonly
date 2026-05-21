import { auth } from "@clerk/nextjs/server";
import { ClerkProvider } from "@clerk/nextjs";
import { cache } from "react";
import AuthedLayout from "~/app/_components/client/layouts/AuthedLayout";
import { Footer } from "~/app/_components/client/public/Footer";
import { ToastProvider } from "~/app/_components/shared/Toast";
import { db } from "~/server/db";
import { TRPCReactProvider } from "~/trpc/react";

// Server-side fetch of the minimal user fields the layout needs to decide
// page chrome (sidebar vs. public) on the first paint. Passing this to
// AuthedLayout as initialUser avoids the client-side flicker where userType
// only arrives after the tRPC query resolves post-hydration. cache() dedupes
// within a single request. Returns null for unauthenticated visitors (public
// pages render fine without a user).
const getLayoutUser = cache(async () => {
	const session = await auth();
	if (!session?.userId) return null;
	return db.user.findUnique({
		where: { clerkUserId: session.userId },
		select: { userType: true, clubShortName: true },
	});
});

function deployedAgo(iso: string | undefined): string | undefined {
	if (!iso || iso === "unknown") return undefined;
	const buildMs = new Date(iso).getTime();
	if (Number.isNaN(buildMs)) return undefined;
	const diffMin = Math.floor((Date.now() - buildMs) / 60_000);
	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const hours = Math.floor(diffMin / 60);
	if (hours < 24) return `${hours}h ${diffMin % 60}m ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ${hours % 24}h ago`;
}

function DeployStamp() {
	const buildSha = process.env.BUILD_SHA;
	if (!buildSha || buildSha === "unknown") return null;
	const ago = deployedAgo(process.env.BUILD_TIMESTAMP);
	if (!ago) return null;
	const shaShort = buildSha.slice(0, 7);
	return (
		<div
			className="mt-6 font-mono text-[12px] text-white/55 uppercase tracking-[0.06em]"
			title={shaShort}
		>
			{`// Last Deployed:  ${ago}`}
		</div>
	);
}

export default async function AppLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	const initialUser = await getLayoutUser();
	return (
		<ClerkProvider>
			<TRPCReactProvider>
				{/* Global toast stack. Mounted once here so any descendant calling
				 * useToast() shares one queue. Container renders inside the
				 * provider — call sites should NOT mount their own. */}
				<ToastProvider>
					<main className="min-h-screen">
						<AuthedLayout initialUser={initialUser}>{children}</AuthedLayout>
					</main>
					<Footer deployStamp={<DeployStamp />} />
				</ToastProvider>
			</TRPCReactProvider>
		</ClerkProvider>
	);
}
