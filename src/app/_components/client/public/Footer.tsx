"use client";

import { Linkedin, ShieldCheck, Twitter, Youtube } from "lucide-react";
import Link from "next/link";
import React from "react";
import AnimatedLogo from "~/app/_components/shared/AnimatedLogo";
import { CALENDLY_URL, SUPPORT_EMAIL, SUPPORT_PHONE } from "~/lib/marketing";

const platformLinks = [
	{ href: "/features", label: "Features" },
	{ href: "/pricing", label: "Pricing" },
	{ href: "#integrations", label: "Integrations" },
	{ href: "#changelog", label: "Changelog" },
	{ href: "#status", label: "Status" },
];

const companyLinks = [
	{ href: "/about", label: "About" },
	{ href: "/customers", label: "Customers" },
	{ href: "/articles", label: "Articles" },
	{ href: "/careers", label: "Careers" },
	{ href: "/contact", label: "Contact" },
];

const resourceLinks = [
	{ href: "/resources/getting-started", label: "Getting started" },
	{ href: "/docs", label: "Documentation" },
	{ href: "/migrate", label: "Migrate from Mindbody" },
	{ href: "/api", label: "API reference" },
];

const legalLinks = [
	{ href: "/terms", label: "Terms" },
	{ href: "/privacy", label: "Privacy" },
	{ href: "/cookies", label: "Cookies" },
];

function ColumnHeading({ children }: { children: React.ReactNode }) {
	return (
		<h4 className="mb-4 font-medium font-mono text-[11px] text-white/50 uppercase tracking-[0.14em]">
			{children}
		</h4>
	);
}

function Col({
	title,
	links,
}: {
	title: string;
	links: { href: string; label: string }[];
}) {
	return (
		<div>
			<ColumnHeading>{title}</ColumnHeading>
			<ul className="space-y-1">
				{links.map((l) => (
					<li key={l.href}>
						<Link
							href={l.href}
							className="block py-1.5 text-[14.5px] text-white/75 transition-colors hover:text-white"
						>
							{l.label}
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

export function Footer({ deployStamp }: { deployStamp?: React.ReactNode }) {
	return (
		<footer className="bg-[var(--ink)] text-white/70" id="resources">
			<div className="container mx-auto px-4 py-16 md:py-20">
				<div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
					{/* Brand + newsletter */}
					<div className="lg:pr-6">
						<Link href="/" className="flex items-center gap-2 text-white">
							<AnimatedLogo size="sm" />
							<span className="font-bold text-lg">Facility Presence</span>
						</Link>
						<p className="mt-4 max-w-[320px] text-sm text-white/60">
							One platform to run your courts — bookings, check-ins, packages,
							payments and reports.
						</p>
						<form
							className="mt-5 flex max-w-[360px] gap-2"
							onSubmit={(e) => e.preventDefault()}
						>
							<input
								type="email"
								placeholder="you@yourclub.com"
								aria-label="Email for operator tips"
								className="flex-1 rounded-[10px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/30"
							/>
							<button type="submit" className="btn btn-primary btn-sm">
								Subscribe
							</button>
						</form>
						<div className="mt-2 text-white/45 text-xs">
							Monthly operator tips. No spam.
						</div>
					</div>

					<Col title="Platform" links={platformLinks} />
					<Col title="Company" links={companyLinks} />
					<Col title="Resources" links={resourceLinks} />

					<div>
						<ColumnHeading>Talk to us</ColumnHeading>
						<a
							href={CALENDLY_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="block py-1.5 text-[14.5px] text-white/75 hover:text-white"
						>
							Book a 15-min demo →
						</a>
						<a
							href={`tel:${SUPPORT_PHONE.replace(/\s|\(|\)|-/g, "")}`}
							className="block py-1.5 text-[14.5px] text-white/75 hover:text-white"
						>
							{SUPPORT_PHONE}
						</a>
						<a
							href={`mailto:${SUPPORT_EMAIL}`}
							className="block py-1.5 text-[14.5px] text-white/75 hover:text-white"
						>
							{SUPPORT_EMAIL}
						</a>
						<div className="mt-2 text-white/55 text-xs">
							Mon–Fri, 8am–6pm ET
						</div>
						<div className="mt-5 flex flex-wrap gap-2">
							<span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-white/70 tracking-[0.06em]">
								<ShieldCheck size={12} />
								SOC 2 Type II
							</span>
							<span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-white/70 tracking-[0.06em]">
								PCI DSS
							</span>
							<span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-white/70 tracking-[0.06em]">
								Stripe Verified
							</span>
						</div>
					</div>
				</div>

				<div className="mt-12 flex flex-col gap-4 border-white/10 border-t pt-6 text-white/50 text-xs sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span>© {new Date().getFullYear()} Facility Presence, Inc.</span>
						<span className="hidden sm:inline">·</span>
						<span>1100 Light St, Baltimore, MD 21230, USA</span>
						{legalLinks.map((l) => (
							<React.Fragment key={l.href}>
								<span className="hidden sm:inline">·</span>
								<Link href={l.href} className="hover:text-white">
									{l.label}
								</Link>
							</React.Fragment>
						))}
					</div>
					<div className="flex gap-2">
						<a
							href="#linkedin"
							aria-label="LinkedIn"
							className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10"
						>
							<Linkedin size={14} />
						</a>
						<a
							href="#youtube"
							aria-label="YouTube"
							className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10"
						>
							<Youtube size={14} />
						</a>
						<a
							href="#x"
							aria-label="X"
							className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10"
						>
							<Twitter size={14} />
						</a>
					</div>
				</div>
				{deployStamp}
			</div>
		</footer>
	);
}

export default Footer;
