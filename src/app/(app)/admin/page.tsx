import {
	Building2,
	FileText,
	FileVideo,
	History,
	LayoutTemplate,
	Receipt,
	ReceiptText,
	Search,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/server/utils/utils";

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
}: {
	title: string;
	description: string;
	icon: React.ComponentType<{ size?: number }>;
	id: string;
}) {
	return (
		<div
			id={id}
			className="scroll-mt-20 rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-gray-300"
		>
			<div className="mb-3 text-[var(--muted-foreground)]">
				<Icon size={24} />
			</div>
			<h3 className="mb-1 font-medium text-[var(--foreground)]">{title}</h3>
			<p className="text-[var(--muted-foreground)] text-sm">{description}</p>
			<p className="mt-3 text-[var(--muted-foreground)] text-xs italic">
				Coming soon
			</p>
		</div>
	);
}

export default async function AdminPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
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
						id="review-post-billing"
						title="Review Post Billing"
						description="View, reprint, and email invoices for the last batch of post-billed packages."
						icon={Search}
					/>
				</div>
			</section>
		</div>
	);
}
