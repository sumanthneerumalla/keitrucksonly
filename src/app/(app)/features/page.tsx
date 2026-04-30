import {
	ArrowRight,
	BarChart3,
	Calendar,
	CheckCircle,
	CreditCard,
	LayoutGrid,
	Mail,
	Play,
	QrCode,
	ShoppingCart,
	Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CTASection } from "~/app/_components/client/public/marketing/CTASection";
import { CRMMock } from "~/app/_components/client/public/mocks/CRMMock";
import { CalendarMock } from "~/app/_components/client/public/mocks/CalendarMock";
import { CheckInMock } from "~/app/_components/client/public/mocks/CheckInMock";
import { CommsMock } from "~/app/_components/client/public/mocks/CommsMock";
import { DashboardMock } from "~/app/_components/client/public/mocks/DashboardMock";
import { POSMock } from "~/app/_components/client/public/mocks/POSMock";
import { PackagesMock } from "~/app/_components/client/public/mocks/PackagesMock";
import { RentalsMock } from "~/app/_components/client/public/mocks/RentalsMock";
import { CALENDLY_URL } from "~/lib/marketing";

export const metadata: Metadata = {
	title: "Features | Facility Presence",
	description:
		"Eight modules, one platform. Court calendar, self-serve check-in, packages, court rentals, CRM, POS, comms, and reports — built for racquet clubs.",
};

type MockKind =
	| "calendar"
	| "checkin"
	| "packages"
	| "rentals"
	| "crm"
	| "pos"
	| "comms"
	| "reports";

interface Section {
	id: string;
	num: string;
	icon: LucideIcon;
	eyebrow: string;
	title: string;
	promise: string;
	body: string;
	bullets: Array<[string, string]>;
	related: Array<[string, string]>;
	mock: MockKind;
}

const SECTIONS: Section[] = [
	{
		id: "checkin",
		num: "01",
		icon: QrCode,
		eyebrow: "Member experience",
		title: "Self-serve check-in",
		promise: "Members tap a QR. Your front desk gets back to selling.",
		body: "Every member has a unique QR in their email and the member app. They scan at the kiosk, the credit deducts (or the lesson confirms), and the front desk only gets pulled in when something's actually wrong. It's the single biggest hour-saver we ship.",
		bullets: [
			[
				"3-second average check-in",
				"Tested across our 240+ live clubs. Slower than that, we get on a call.",
			],
			[
				"Works on iPad or any tablet",
				"Bring your own hardware or buy our $189 kiosk bundle.",
			],
			[
				"Walk-in flow with payment",
				"Guests pay at the kiosk via Stripe Terminal — no front-desk handoff.",
			],
			[
				"Cross-links to credits, packages, lessons",
				"Members on a 10-pack? We deduct. Member of the league? We log attendance.",
			],
		],
		related: [
			["packages", "Packages & credits"],
			["pos", "Point of sale"],
			["crm", "Member CRM"],
		],
		mock: "checkin",
	},
	{
		id: "calendar",
		num: "02",
		icon: Calendar,
		eyebrow: "Operations",
		title: "Court calendar",
		promise:
			"Drag-and-drop bookings across every court — without the double-book gremlin.",
		body: "One view of every court, every minute, every booking. Drag to reschedule. Resize to extend. Color-coded by type — rentals, classes, leagues, lessons, blocks, open play. Conflicts get caught at booking-time, not at 7am Saturday when two members show up for one court.",
		bullets: [
			[
				"Day, week, month, court-grid views",
				"Operators live in week. Members pick the day they want.",
			],
			[
				"Recurring bookings & blocks",
				"Maintenance windows, league nights, coach availability — all repeat-friendly.",
			],
			[
				"Public booking widget",
				"Embed on your existing site or use ours. Members pay or use credits in the same flow.",
			],
			[
				"Waitlist with auto-promote",
				"Cancellation? The next member on the waitlist gets the slot at 9:01am.",
			],
		],
		related: [
			["checkin", "Self-serve check-in"],
			["rentals", "Court rentals"],
			["comms", "Email & SMS"],
		],
		mock: "calendar",
	},
	{
		id: "packages",
		num: "03",
		icon: CreditCard,
		eyebrow: "Revenue",
		title: "Packages & credits",
		promise:
			"Sell 10-packs and memberships — credits deduct on check-in, oldest first.",
		body: 'The credit math your operators were doing in their head. Sell single-session, multi-session, monthly, or annual. Credits expire on a schedule you set. We deduct oldest credits first — "first in, first out" — so members never get burned by a forgotten expiration. Refunds, transfers, family-shares: all in one place.',
		bullets: [
			[
				"Multi-session packs (5/10/20 sessions)",
				"Set per-pack pricing, expiration, and which class types they unlock.",
			],
			[
				"Monthly memberships with auto-renew",
				"Pause, transfer, or refund without a Stripe dashboard side-quest.",
			],
			[
				"Family & corporate accounts",
				"Shared credit pools, separate logins, one invoice.",
			],
			[
				"FIFO credit usage (oldest first)",
				"Members spend the credits closest to expiring. They thank you for it.",
			],
		],
		related: [
			["checkin", "Self-serve check-in"],
			["pos", "Point of sale"],
			["reports", "Reports"],
		],
		mock: "packages",
	},
	{
		id: "rentals",
		num: "04",
		icon: LayoutGrid,
		eyebrow: "Programs",
		title: "Court rentals & open play",
		promise:
			"Hourly rates, peak pricing, member-only windows. Walk-ins pay; everyone else just shows up.",
		body: "The variable pricing your spreadsheet was almost handling. Off-peak versus peak, member versus guest, hour versus hour-and-a-half. Block off member-only windows so courts are protected when it matters. Open play with capacity caps so the 6pm pickleball jam doesn't overflow.",
		bullets: [
			[
				"Tiered pricing by hour, day, member tier",
				"Define once. Apply across all courts or per-court.",
			],
			[
				"Member-only windows",
				"Lock 6–9pm to members on the gold tier. We refund any guest who books accidentally.",
			],
			[
				"Open play with capacity caps",
				"Set the cap per session. Members reserve a slot, not a court.",
			],
			[
				"Group rentals & private events",
				"Birthday party on Court 4? Block it, charge it, get the deposit.",
			],
		],
		related: [
			["calendar", "Court calendar"],
			["packages", "Packages & credits"],
			["comms", "Email & SMS"],
		],
		mock: "rentals",
	},
	{
		id: "crm",
		num: "05",
		icon: Users,
		eyebrow: "Member experience",
		title: "Member CRM",
		promise:
			"One profile per member. Everything they've done, owe, and asked for — in one keystroke.",
		body: "The thing your front desk has been writing on Post-it notes. Bookings, attendance, credits, payments, notes, family connections, allergy flags, billing issues — searchable, sortable, exportable. With a member-facing profile they actually maintain, because we made it the place they book courts.",
		bullets: [
			[
				"Universal search (⌘K from any screen)",
				"Find any member, any booking, any payment in two keystrokes.",
			],
			[
				"Notes, tags & flags",
				'"Refund pending", "VIP", "Asked about leagues". Filterable from Reports.',
			],
			[
				"Member-app self-service",
				"Update card, change email, see credits. They self-serve, you don't get a ticket.",
			],
			["Full history export", "CSV, JSON, or live to your warehouse via API."],
		],
		related: [
			["checkin", "Self-serve check-in"],
			["comms", "Email & SMS"],
			["reports", "Reports"],
		],
		mock: "crm",
	},
	{
		id: "pos",
		num: "06",
		icon: ShoppingCart,
		eyebrow: "Revenue",
		title: "Point of sale",
		promise:
			"Sell paddles, restrings, drinks, drop-ins. Inventory updates as you ring.",
		body: "The on-site retail your operators were running through Square in a separate browser tab. Stripe Terminal-ready. Inventory by product or by category, with low-stock alerts. Tied to the same member profiles, so a $90 paddle goes on Maya's tab and shows up in her receipts and your sales reports.",
		bullets: [
			[
				"Stripe Terminal integration",
				"Tap-to-pay on iPhone or our $89 reader. No separate POS hardware.",
			],
			[
				"Member tabs & house accounts",
				'"Put it on my account" — settled at month-end with one click.',
			],
			[
				"Inventory with categories & low-stock alerts",
				"Email when restring inventory drops below 10. Re-order from the alert.",
			],
			[
				"Itemized receipts emailed automatically",
				"Members get receipts. You get clean accounting. Stripe gets nothing extra.",
			],
		],
		related: [
			["checkin", "Self-serve check-in"],
			["packages", "Packages & credits"],
			["reports", "Reports"],
		],
		mock: "pos",
	},
	{
		id: "comms",
		num: "07",
		icon: Mail,
		eyebrow: "Member experience",
		title: "Targeted email & SMS",
		promise:
			"24-hour reminders, league announcements, waitlist offers — no Mailchimp logins.",
		body: "The communications layer your other tools were leaving you to glue together. Automated reminders 24 and 2 hours before a booking, no-show fees triggered after a window, league-night announcements to a saved segment, broadcast SMS for a court closure. With branding that matches your facility, not ours.",
		bullets: [
			[
				"Triggered automations (book, cancel, no-show)",
				"Each event has its own template. Customize once, runs forever.",
			],
			[
				"Audience segments",
				'"Members who haven\'t booked in 30 days". One-click win-back campaign.',
			],
			[
				"Branded sender domain",
				"Emails come from courts@yourclub.com. Two DNS records, done.",
			],
			[
				"SMS with delivery + opt-out compliance",
				"TCPA-aware. We block sends to opted-out members and log everything.",
			],
		],
		related: [
			["calendar", "Court calendar"],
			["crm", "Member CRM"],
			["packages", "Packages & credits"],
		],
		mock: "comms",
	},
	{
		id: "reports",
		num: "08",
		icon: BarChart3,
		eyebrow: "Operations",
		title: "Reports & insight",
		promise:
			"Court utilization, revenue per hour, churn cohorts, refund leakage. Exportable.",
		body: 'The reporting your CFO has been begging for. Pre-built dashboards for utilization, revenue, member growth, and churn. A flexible "explore" view to slice by court, member tier, league, or program. Exports to CSV, scheduled emails, and an API for the operators who pipe it into their own warehouse.',
		bullets: [
			[
				"Utilization heatmap",
				"Which hours on which courts are paying for the lights. Which aren't.",
			],
			[
				"Revenue by program",
				"Leagues vs. open play vs. lessons vs. retail. Settle the never-ending debate.",
			],
			[
				"Cohort churn analysis",
				"Members who joined in March — how many are still here in September?",
			],
			[
				"CSV export & email schedule",
				"Set it once. The owner gets Monday morning revenue numbers, automatically.",
			],
		],
		related: [
			["packages", "Packages & credits"],
			["pos", "Point of sale"],
			["crm", "Member CRM"],
		],
		mock: "reports",
	},
];

function MockPanel({ kind }: { kind: MockKind }) {
	switch (kind) {
		case "calendar":
			return <CalendarMock />;
		case "checkin":
			return <CheckInMock />;
		case "packages":
			return <PackagesMock />;
		case "rentals":
			return <RentalsMock />;
		case "crm":
			return <CRMMock />;
		case "pos":
			return <POSMock />;
		case "comms":
			return <CommsMock />;
		case "reports":
			return <DashboardMock />;
	}
}

function FeatureSection({ s, idx }: { s: Section; idx: number }) {
	const reverse = idx % 2 === 1;
	return (
		<section
			id={s.id}
			className="py-20 md:py-[120px]"
			style={{ background: idx % 2 ? "var(--paper-2)" : "var(--paper)" }}
		>
			<div className="container mx-auto grid items-center gap-10 px-4 lg:gap-14">
				<div
					className={`grid grid-cols-1 items-center gap-10 lg:gap-14 ${reverse ? "lg:grid-cols-[1fr_1.05fr]" : "lg:grid-cols-[1.05fr_1fr]"}`}
				>
					<div className={reverse ? "lg:order-2" : ""}>
						<div className="flex items-center gap-3.5 font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
							<span className="min-w-9 border-[var(--ink)] border-t pt-1.5">
								{s.num}
							</span>
							<span>{s.eyebrow}</span>
						</div>
						<h2 className="mt-4">{s.title}</h2>
						<p className="lead mt-3.5 text-[var(--ink)]">{s.promise}</p>
						<p className="mt-3.5 max-w-[560px] text-[var(--ink-2)]">{s.body}</p>

						<ul className="mt-6 grid list-none gap-3.5 p-0 sm:grid-cols-2">
							{s.bullets.map(([t, b]) => (
								<li key={t} className="border-[var(--line)] border-t pt-3">
									<div className="flex items-start gap-2">
										<CheckCircle
											size={16}
											className="mt-1 flex-shrink-0 text-[var(--brand)]"
										/>
										<div>
											<div className="font-semibold">{t}</div>
											<div className="mt-0.5 text-[13.5px] text-[var(--ink-3)]">
												{b}
											</div>
										</div>
									</div>
								</li>
							))}
						</ul>

						<div className="mt-6 flex flex-wrap gap-2.5">
							<a
								href={CALENDLY_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn-primary"
							>
								See it live in a demo <span className="arrow">→</span>
							</a>
							<a
								href={CALENDLY_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn-text"
							>
								<Play size={14} /> Watch 30-sec demo
							</a>
						</div>

						<div className="mt-5 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink-3)]">
							<span className="font-mono uppercase tracking-[0.06em]">
								Wires into:
							</span>
							{s.related.map(([id, n]) => (
								<Link
									key={id}
									href={`#${id}`}
									className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1 text-[12.5px] text-[var(--ink-2)] hover:border-[var(--line-2)]"
								>
									{n} ↗
								</Link>
							))}
						</div>
					</div>

					<div className={reverse ? "lg:order-1" : ""}>
						<div className="rounded-[28px] bg-[var(--ink)] p-3.5 shadow-[0_24px_60px_-20px_rgba(20,19,14,0.18)]">
							<div className="min-h-[380px] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[var(--paper)]">
								<MockPanel kind={s.mock} />
							</div>
							<div className="flex justify-between px-1.5 pt-2.5 font-mono text-[12px] text-white/55 uppercase tracking-[0.06em]">
								<span>{`// ${s.id} preview`}</span>
								<span>v4.12</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function PageHero() {
	return (
		<section className="pt-8 pb-8 md:pt-12">
			<div className="container mx-auto px-4">
				<div className="eyebrow">
					<span className="eyebrow-dot">●</span>
					&nbsp;&nbsp;EVERY MODULE, EXPLAINED
				</div>
				<h1 className="mt-3.5 max-w-[1000px]">
					Eight modules. <span className="accent">One platform.</span>
					<br />
					Built for racquet clubs, line by line.
				</h1>
				<p className="lead mt-5 max-w-[720px]">
					We replaced four tools and a clipboard. Each section below shows a
					real piece of the product, links to the modules it talks to, and ends
					with a way to see it in action.
				</p>

				<div className="mt-9 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
					{SECTIONS.map((s) => {
						const Icon = s.icon;
						return (
							<Link
								key={s.id}
								href={`#${s.id}`}
								className="flex items-center gap-2.5 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-3.5 py-3 font-medium text-[13.5px] text-[var(--ink)] transition-colors hover:border-[var(--line-2)]"
							>
								<Icon size={16} className="text-[var(--brand)]" />
								<span className="flex-1">{s.title}</span>
								<span className="font-mono text-[11px] text-[var(--ink-4)]">
									{s.num}
								</span>
							</Link>
						);
					})}
				</div>
			</div>
		</section>
	);
}

export default function FeaturesPage() {
	return (
		<div className="marketing-page">
			<PageHero />
			{SECTIONS.map((s, i) => (
				<FeatureSection key={s.id} s={s} idx={i} />
			))}
			<CTASection />
		</div>
	);
}
