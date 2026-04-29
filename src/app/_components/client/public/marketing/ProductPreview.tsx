"use client";

import { BarChart3, Calendar, QrCode } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { CalendarMock } from "~/app/_components/client/public/mocks/CalendarMock";

// Inactive tabs are dynamically imported so they don't ship with the home page's
// initial JS bundle. The active tab on first paint is "calendar", which we keep
// as a static import so the hero renders immediately.
const CheckInMock = dynamic(
	() =>
		import("~/app/_components/client/public/mocks/CheckInMock").then(
			(m) => m.CheckInMock,
		),
	{ ssr: false, loading: () => <MockLoading /> },
);

const DashboardMock = dynamic(
	() =>
		import("~/app/_components/client/public/mocks/DashboardMock").then(
			(m) => m.DashboardMock,
		),
	{ ssr: false, loading: () => <MockLoading /> },
);

function MockLoading() {
	return (
		<div className="flex min-h-[460px] items-center justify-center">
			<span className="font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
				Loading…
			</span>
		</div>
	);
}

type TabId = "calendar" | "checkin" | "dashboard";

const TABS: Array<{
	id: TabId;
	label: string;
	icon: React.ReactNode;
	live?: boolean;
}> = [
	{ id: "calendar", label: "Court calendar", icon: <Calendar size={14} /> },
	{ id: "checkin", label: "Member check-in", icon: <QrCode size={14} /> },
	{
		id: "dashboard",
		label: "Owner dashboard",
		icon: <BarChart3 size={14} />,
		live: true,
	},
];

export function ProductPreview() {
	const [tab, setTab] = useState<TabId>("calendar");

	return (
		<div className="rounded-[28px] bg-[var(--ink)] p-3.5 shadow-[0_24px_60px_-20px_rgba(20,19,14,0.18)]">
			<div className="mb-3 flex flex-wrap gap-1 rounded-[12px] bg-white/[0.04] p-2">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`inline-flex items-center gap-2 rounded-[8px] px-3.5 py-2 font-medium text-[13.5px] transition-colors ${
							tab === t.id
								? "bg-white/10 text-white"
								: "text-white/60 hover:text-white"
						}`}
					>
						{t.icon}
						{t.label}
						{t.live ? (
							<span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-[var(--brand)]/35 px-1.5 py-px font-mono text-[#DDD2FF] text-[10px] tracking-[0.04em]">
								LIVE
							</span>
						) : null}
					</button>
				))}
			</div>
			<div className="min-h-[460px] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[var(--paper)]">
				{tab === "calendar" ? <CalendarMock /> : null}
				{tab === "checkin" ? <CheckInMock /> : null}
				{tab === "dashboard" ? <DashboardMock /> : null}
			</div>
			<div className="flex items-center justify-between px-1.5 pt-2.5 font-mono text-[12px] text-white/55 uppercase tracking-[0.06em]">
				<span>{"// Live product preview · click any tab"}</span>
				<span>v4.12 · build 2026.04.21</span>
			</div>
		</div>
	);
}

export default ProductPreview;
