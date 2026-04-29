import {
	ArrowRight,
	BarChart3,
	Calendar,
	CreditCard,
	LayoutGrid,
	Mail,
	QrCode,
	ShoppingCart,
	Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { SectionHead } from "~/app/_components/client/public/marketing/SectionHead";

interface FeatureCardData {
	icon: LucideIcon;
	eyebrow: string;
	title: string;
	body: string;
	anchor: string;
}

const FEATURES: FeatureCardData[] = [
	{
		icon: QrCode,
		eyebrow: "Operations",
		title: "Self-serve check-in",
		body: "Members tap a QR at the door — your front desk gets back to selling, not scanning IDs.",
		anchor: "checkin",
	},
	{
		icon: Calendar,
		eyebrow: "Operations",
		title: "Court calendar that won't double-book",
		body: "Drag-and-drop bookings, blocks, and lessons across every court — with conflicts caught before they happen.",
		anchor: "calendar",
	},
	{
		icon: CreditCard,
		eyebrow: "Revenue",
		title: "Packages & credits",
		body: "Sell 10-packs, monthly memberships, and class credits. We deduct on check-in (FIFO — oldest credits first).",
		anchor: "packages",
	},
	{
		icon: LayoutGrid,
		eyebrow: "Programs",
		title: "Court rentals & open play",
		body: "Hourly rates, peak pricing, member-only windows. Walk-ins pay at the kiosk; everyone else just shows up.",
		anchor: "rentals",
	},
	{
		icon: Users,
		eyebrow: "Member experience",
		title: "Member CRM that actually fits",
		body: "One profile per member: bookings, credits, attendance, payments, notes — searchable in one keystroke.",
		anchor: "crm",
	},
	{
		icon: ShoppingCart,
		eyebrow: "Revenue",
		title: "On-site point of sale",
		body: "Sell paddles, restrings, drinks, drop-ins. Stripe Terminal-ready, with inventory that updates as you ring.",
		anchor: "pos",
	},
	{
		icon: Mail,
		eyebrow: "Member experience",
		title: "Targeted email & SMS",
		body: "Automatic 24-hour reminders, league announcements, and waitlist offers — no Mailchimp logins required.",
		anchor: "comms",
	},
	{
		icon: BarChart3,
		eyebrow: "Operations",
		title: "Reports your CFO will read",
		body: "Court utilization, revenue per hour, churn cohorts, refund leakage — exported to CSV or your inbox.",
		anchor: "reports",
	},
];

const GROUPS: Array<{ name: string; titles: string[] }> = [
	{
		name: "Operations",
		titles: [
			"Self-serve check-in",
			"Court calendar that won't double-book",
			"Reports your CFO will read",
			"Court rentals & open play",
		],
	},
	{
		name: "Revenue",
		titles: ["Packages & credits", "On-site point of sale"],
	},
	{
		name: "Member experience",
		titles: ["Member CRM that actually fits", "Targeted email & SMS"],
	},
];

function FeatureCard({ f }: { f: FeatureCardData }) {
	const Icon = f.icon;
	return (
		<Link href={`/features#${f.anchor}`} className="mk-card flex flex-col">
			<Icon size={28} className="mb-4 text-[var(--brand)]" />
			<div className="mb-1.5 font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.1em]">
				{f.eyebrow}
			</div>
			<h3 className="mb-1.5">{f.title}</h3>
			<p className="text-[15px] text-[var(--ink-2)]">{f.body}</p>
			<span className="mt-3.5 inline-flex items-center gap-1.5 font-medium text-[14px] text-[var(--brand)]">
				See it in action <ArrowRight size={14} />
			</span>
		</Link>
	);
}

export function FeatureGrid() {
	return (
		<section className="py-20 md:py-[120px]" id="features">
			<div className="container mx-auto px-4">
				<SectionHead
					num="02 / Modules"
					title="Run your club, not your software stack."
					lead="Eight modules, one logged-in session. Each card is a benefit — click through for the receipts."
				/>

				{GROUPS.map((g, gi) => {
					const groupFeatures = FEATURES.filter((f) =>
						g.titles.includes(f.title),
					);
					return (
						<div key={g.name} className={gi < GROUPS.length - 1 ? "mb-14" : ""}>
							<div className="mb-4 flex items-baseline gap-3.5">
								<span className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
									{g.name}
								</span>
								<span className="h-px flex-1 bg-[var(--line)]" />
							</div>
							<div
								className={`grid gap-4 sm:grid-cols-2 ${groupFeatures.length >= 4 ? "lg:grid-cols-4" : groupFeatures.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}
							>
								{groupFeatures.map((f) => (
									<FeatureCard key={f.title} f={f} />
								))}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

export default FeatureGrid;
