import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { CALENDLY_URL } from "~/lib/marketing";

export function CTASection() {
	return (
		<section className="py-20 md:py-[120px]" id="demo">
			<div className="container mx-auto px-4">
				<div className="relative grid items-center gap-10 overflow-hidden rounded-[28px] bg-[var(--ink)] px-7 py-12 text-[var(--paper)] md:px-14 md:py-[72px] lg:grid-cols-[1.3fr_1fr] lg:gap-12">
					<div
						className="pointer-events-none absolute inset-0"
						style={{
							background:
								"radial-gradient(80% 120% at 100% 0%, rgba(79,70,229,0.4), transparent 60%)",
						}}
					/>
					<div className="relative">
						<div className="font-mono text-[12px] text-white/55 uppercase tracking-[0.14em]">
							● &nbsp;Get started
						</div>
						<h2
							className="mt-3.5"
							style={{
								color: "var(--paper)",
								fontSize: "clamp(32px, 4.2vw, 60px)",
							}}
						>
							Run your courts on one platform.
						</h2>
						<p className="mt-4 max-w-[520px] text-[18px] text-white/70">
							Book a 15-minute demo. We'll show you the calendar, the kiosk, and
							the dashboard with a copy of your real schedule loaded in.
						</p>
						<div className="mt-7 flex flex-wrap gap-3">
							<a
								href={CALENDLY_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn-primary btn-lg"
							>
								Book a 15-min demo <span className="arrow">→</span>
							</a>
							<Link
								href="/pricing"
								className="btn btn-ghost btn-lg"
								style={{
									color: "var(--paper)",
									borderColor: "rgba(250,248,243,0.25)",
								}}
							>
								See pricing
							</Link>
							<Link
								href="/features"
								className="btn btn-text btn-lg"
								style={{ color: "var(--brand-200)" }}
							>
								Browse features
							</Link>
						</div>
						<div className="mt-[18px] flex flex-wrap gap-4 text-[13px] text-white/55">
							<span>● No credit card</span>
							<span>● Cancel anytime</span>
							<span>● Free migration</span>
						</div>
					</div>

					<div className="relative rounded-[18px] border border-white/[0.08] bg-white/[0.04] p-5">
						<div className="font-mono text-[11px] text-white/55 uppercase tracking-[0.1em]">
							{"// What you'll see in 15 min"}
						</div>
						<ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
							{[
								"Your real court calendar, dragged in",
								"QR kiosk on your facility's network",
								"Package + credit math, end-to-end",
								"An honest answer on price",
							].map((t) => (
								<li
									key={t}
									className="flex items-start gap-2.5 text-[var(--paper)]"
								>
									<CheckCircle
										size={18}
										className="mt-0.5 flex-shrink-0 text-[var(--brand-200)]"
									/>
									<span className="text-[15px]">{t}</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>
		</section>
	);
}

export default CTASection;
