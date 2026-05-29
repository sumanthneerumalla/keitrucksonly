"use client";

import DOMPurify from "isomorphic-dompurify";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { AnnouncementCard } from "~/lib/announcement";
import { api } from "~/trpc/react";

interface AnnouncementFeedProps {
	clubShortName: string;
	initialItems: AnnouncementCard[];
	initialCursor?: string;
}

/**
 * Phase 15 Step 6 — Public single-scrollable-feed component.
 *
 * Strategy: server pre-fetches page 1 (so the first paint is full-content + SEO
 * meta). Client takes over for "Load more" pagination via cursor — appending
 * to local state. Simple load-more button (not infinite scroll) — keeps
 * keyboard accessibility, predictable scroll, and matches the operational
 * feel of an announcements board.
 *
 * Each announcement renders as a card: avatar + author + relative date header,
 * optional title, optional cover image, sanitized body HTML. No per-item URL.
 */
export default function AnnouncementFeed({
	clubShortName,
	initialItems,
	initialCursor,
}: AnnouncementFeedProps) {
	const [items, setItems] = useState<AnnouncementCard[]>(initialItems);
	const [cursor, setCursor] = useState<string | undefined>(initialCursor);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const utils = api.useUtils();

	const loadMore = async () => {
		if (!cursor || loading) return;
		setLoading(true);
		setError(null);
		try {
			const next = await utils.announcements.listPublished.fetch({
				clubShortName,
				limit: 20,
				cursor,
			});
			setItems((prev) => [...prev, ...next.items]);
			setCursor(next.nextCursor);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Failed to load more announcements",
			);
		} finally {
			setLoading(false);
		}
	};

	if (items.length === 0) {
		return (
			<div className="rounded-2xl border border-[var(--line)] border-dashed bg-[var(--paper)] p-12 text-center">
				<h2 className="font-display font-semibold text-[24px] text-[var(--ink)]">
					No announcements yet
				</h2>
				<p className="mx-auto mt-3 max-w-[460px] text-[var(--ink-2)]">
					Check back soon — new announcements will appear here.
				</p>
			</div>
		);
	}

	return (
		<div>
			<div className="mx-auto max-w-[760px] divide-y divide-[var(--line)]">
				{items.map((announcement) => (
					<AnnouncementItem key={announcement.id} announcement={announcement} />
				))}
			</div>

			{cursor ? (
				<div className="mt-10 flex justify-center">
					<button
						type="button"
						onClick={() => void loadMore()}
						disabled={loading}
						className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--paper)] px-6 py-2.5 font-medium text-[14px] text-[var(--ink-2)] transition-colors hover:border-[var(--line-2)] hover:text-[var(--ink)] disabled:opacity-50"
					>
						{loading ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading…
							</>
						) : (
							"Load more"
						)}
					</button>
				</div>
			) : null}

			{error ? (
				<p className="mt-4 text-center text-destructive text-sm">{error}</p>
			) : null}
		</div>
	);
}

function AnnouncementItem({
	announcement,
}: {
	announcement: AnnouncementCard;
}) {
	// NOTE: Default DOMPurify allowlist. For Phase 15b (MindStudio-style CTAs),
	// extend with ADD_ATTR: ["data-cta", "data-cta-id", "data-cta-variant"]
	// and ADD_TAGS as needed for any new HTML primitives the CTA TipTap node emits.
	// See designFiles/roadmap/phase15-articles-and-announcements.md §"CTA support".
	const safeHtml = DOMPurify.sanitize(announcement.bodyHtml);

	return (
		<article className="py-10">
			{/* Author + date header */}
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-[var(--ink-3)]">
				<div className="flex items-center gap-2.5 text-[var(--ink-2)]">
					{announcement.author.avatarUrl ? (
						<img
							src={announcement.author.avatarUrl}
							alt={announcement.author.name}
							className="h-8 w-8 rounded-full object-cover"
						/>
					) : (
						<span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--paper-2)] font-medium text-[12px] text-[var(--ink-2)]">
							{announcement.author.name.charAt(0)}
						</span>
					)}
					<span className="font-medium">{announcement.author.name}</span>
				</div>
				<span aria-hidden="true">·</span>
				<time dateTime={announcement.publishedAt.toISOString()}>
					{formatRelative(announcement.publishedAt)}
				</time>
			</header>

			{announcement.title ? (
				<h2 className="mt-4 font-display font-semibold text-[26px] text-[var(--ink)] leading-snug tracking-[-0.01em]">
					{announcement.title}
				</h2>
			) : null}

			{announcement.coverImageUrl ? (
				<div className="mt-5 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-2)]">
					<img
						src={announcement.coverImageUrl}
						alt={announcement.coverImageAlt ?? announcement.title ?? ""}
						className="w-full object-cover"
					/>
				</div>
			) : null}

			<div
				className="prose prose-base mt-5 max-w-none prose-img:rounded-xl prose-blockquote:border-l-[var(--brand)] prose-headings:font-display prose-a:text-[var(--brand)] prose-blockquote:text-[var(--ink-2)] prose-code:text-[var(--ink)] prose-headings:text-[var(--ink)] prose-p:text-[var(--ink-2)] prose-strong:text-[var(--ink)] prose-a:no-underline hover:prose-a:underline"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via isomorphic-dompurify before render
				dangerouslySetInnerHTML={{ __html: safeHtml }}
			/>
		</article>
	);
}

function formatRelative(date: Date): string {
	const now = Date.now();
	const then = new Date(date).getTime();
	const diffSec = Math.round((then - now) / 1000);
	const abs = Math.abs(diffSec);

	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

	if (abs < 60) return rtf.format(diffSec, "second");
	if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
	if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
	if (abs < 86400 * 365)
		return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
	return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}
