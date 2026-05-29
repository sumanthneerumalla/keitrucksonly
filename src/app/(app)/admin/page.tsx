import {
	Building2,
	FileText,
	FileVideo,
	History,
	LayoutTemplate,
	Megaphone,
	Newspaper,
	Receipt,
	ReceiptText,
	Search,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isStaffOrAbove } from "~/server/utils/utils";

const quickLinks = [
	{
		title: "Facilities",
		description: "Create and manage physical locations for your club.",
		href: "/admin/facilities",
		icon: Building2,
	},
	{
		title: "All Collections",
		description: "View and manage all video collections across the club.",
		href: "/admin/collections",
		icon: FileVideo,
	},
	{
		title: "Articles",
		description: "Write and manage articles.",
		href: "/admin/articles",
		icon: Newspaper,
	},
	{
		title: "Announcements",
		description: "Post and manage your club's announcements.",
		href: "/admin/announcements",
		icon: Megaphone,
	},
	{
		title: "Database",
		description: "Prisma Studio — browse and edit database records directly.",
		href: "/database",
		icon: Search,
	},
];

function SectionCard({
	title,
	description,
	icon: Icon,
	id,
	href,
}: {
	title: string;
	description: string;
	icon: React.ComponentType<{ size?: number }>;
	id: string;
	/**
	 * Optional destination. When set, the card renders as a clickable `<Link>`
	 * (no "Coming soon" footer). When omitted, the card is a placeholder for
	 * a future feature.
	 */
	href?: string;
}) {
	const body = (
		<>
			<div className="mb-3 text-[var(--muted-foreground)]">
				<Icon size={24} />
			</div>
			<h3 className="mb-1 font-medium text-[var(--foreground)]">{title}</h3>
			<p className="text-[var(--muted-foreground)] text-sm">{description}</p>
			{!href && (
				<p className="mt-3 text-[var(--muted-foreground)] text-xs italic">
					Coming soon
				</p>
			)}
		</>
	);

	if (href) {
		return (
			<Link
				id={id}
				href={href}
				className="group scroll-mt-20 rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[var(--primary)] hover:shadow-sm"
			>
				{body}
			</Link>
		);
	}

	return (
		<div
			id={id}
			className="scroll-mt-20 rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-gray-300"
		>
			{body}
		</div>
	);
}

export default async function AdminPage() {
	const user = await getOnboardedUserOrRedirect();

	// Phase 15 Stage 2 (Q1): coaches can author articles, so the admin index
	// needs to be reachable for them too. Other admin cards on this page (e.g.
	// Facilities, Database) are still gated at their own route level if needed.
	if (!isStaffOrAbove(user)) {
		redirect("/dashboard");
	}

	return (
		<div className="p-6">
			<h1 className="mb-6 font-semibold text-2xl text-[var(--foreground)]">
				Admin
			</h1>

			{/* Quick Links */}
			<div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{quickLinks.map((card) => {
					const Icon = card.icon;
					return (
						<Link
							key={card.href}
							href={card.href}
							className="group rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[var(--primary)] hover:shadow-sm"
						>
							<div className="mb-3 text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--primary)]">
								<Icon size={24} />
							</div>
							<h2 className="mb-1 font-medium text-[var(--foreground)]">
								{card.title}
							</h2>
							<p className="text-[var(--muted-foreground)] text-sm">
								{card.description}
							</p>
						</Link>
					);
				})}
			</div>

			{/* Documents Section */}
			<section id="documents" className="mb-10 scroll-mt-20">
				<div className="mb-4 flex items-center gap-2">
					<FileText size={20} className="text-[var(--muted-foreground)]" />
					<h2 className="font-medium text-[var(--foreground)] text-lg">
						Documents
					</h2>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<SectionCard
						id="document-history"
						title="Document History"
						description="View history and status of all documents."
						icon={History}
					/>
					<SectionCard
						id="document-templates"
						title="Document Templates"
						description="Create and edit templates used when generating documents."
						icon={LayoutTemplate}
					/>
				</div>
			</section>

			{/* Billing Section */}
			<section id="billing" className="mb-10 scroll-mt-20">
				<div className="mb-4 flex items-center gap-2">
					<Receipt size={20} className="text-[var(--muted-foreground)]" />
					<h2 className="font-medium text-[var(--foreground)] text-lg">
						Billing
					</h2>
				</div>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<SectionCard
						id="uninvoiced-user"
						title="Un-Invoiced Items: User"
						description="The list of uninvoiced items for the logged-in user."
						icon={ReceiptText}
					/>
					<SectionCard
						id="uninvoiced-location"
						title="Un-Invoiced Items: Location"
						description="The list of uninvoiced items for this location."
						icon={Receipt}
					/>
					<SectionCard
						id="billed-invoices"
						title="Billed Invoices"
						description="View, search, and manage every invoice issued across the club."
						icon={Search}
						href="/admin/invoices"
					/>
				</div>
			</section>
		</div>
	);
}
