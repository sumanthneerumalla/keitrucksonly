import { ClerkProvider } from "@clerk/nextjs";
import AuthedLayout from "~/app/_components/client/layouts/AuthedLayout";
import { Footer } from "~/app/_components/client/public/Footer";
import { ToastProvider } from "~/app/_components/shared/Toast";
import { TRPCReactProvider } from "~/trpc/react";

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

export default function AppLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<ClerkProvider>
			<TRPCReactProvider>
				{/* Global toast stack. Mounted once here so any descendant calling
				 * useToast() shares one queue. Container renders inside the
				 * provider — call sites should NOT mount their own. */}
				<ToastProvider>
					<main className="min-h-screen">
						<AuthedLayout>{children}</AuthedLayout>
					</main>
					<Footer deployStamp={<DeployStamp />} />
				</ToastProvider>
			</TRPCReactProvider>
		</ClerkProvider>
	);
}
