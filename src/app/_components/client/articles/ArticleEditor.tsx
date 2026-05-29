"use client";

import { ArticleStatus } from "@prisma/client";
import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	Loader2,
	Lock,
	Save,
	Send,
	Trash2,
	X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import RichTextEditor from "~/app/_components/client/shared/RichTextEditor";
import { useToast } from "~/app/_components/shared/Toast";
import { type AdminArticleDetail, CONTENT_IMAGE_URL } from "~/lib/article";
import { slugify } from "~/lib/slug";
import { api } from "~/trpc/react";
import TagPicker from "./TagPicker";

// Phase 15 Stage 2 — scope picker state value.
//   "PLATFORM" → clubShortName === null on submit
//   <string>   → clubShortName === <string> on submit
type ScopeValue = "PLATFORM" | string;

interface ArticleEditorProps {
	initial?: AdminArticleDetail;
	currentUser: {
		userId: string;
		userType: string;
		clubShortName: string;
		firstName: string | null;
		lastName: string | null;
	};
	clubsAvailable: { clubShortName: string; clubName: string }[];
	/** @deprecated: unauthorized callers are now redirected at the page level. Kept as defensive backstop. */
	readOnly?: boolean;
}

const META_TITLE_MAX = 200;
const META_DESCRIPTION_MAX = 500;
const TITLE_MAX = 200;
const SLUG_MAX = 200;
const EXCERPT_MAX = 500;

export default function ArticleEditor({
	initial,
	currentUser,
	clubsAvailable,
	readOnly = false,
}: ArticleEditorProps) {
	const router = useRouter();
	const utils = api.useUtils();
	const { toast } = useToast();

	const isEdit = Boolean(initial);
	const isPlatformAdmin = currentUser.userType === "PLATFORM_ADMIN";

	// ─── Scope state ──────────────────────────────────────────────────────────
	// New + PLATFORM_ADMIN: dropdown, default "PLATFORM".
	// New + other staff: forced to caller's club (read-only badge).
	// Edit: locked to article's existing scope (read-only badge).
	const initialScope: ScopeValue = (() => {
		if (initial) {
			return initial.clubShortName === null
				? "PLATFORM"
				: initial.clubShortName;
		}
		if (isPlatformAdmin) return "PLATFORM";
		return currentUser.clubShortName;
	})();
	const [scope, setScope] = useState<ScopeValue>(initialScope);

	// Resolved scope as a clubShortName (null for platform). Used to feed
	// `clubShortName` to TagPicker + create payload.
	const resolvedClubShortName: string | null =
		scope === "PLATFORM" ? null : scope;

	const clubNameByShort = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of clubsAvailable) m.set(c.clubShortName, c.clubName);
		return m;
	}, [clubsAvailable]);

	const scopeBadgeText = (): string => {
		if (scope === "PLATFORM") return "Platform";
		return clubNameByShort.get(scope) ?? scope;
	};

	// ─── Field state ──────────────────────────────────────────────────────────

	const [title, setTitle] = useState(initial?.title ?? "");
	const [slug, setSlug] = useState(initial?.slug ?? "");
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(
		Boolean(initial),
	);
	const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
	const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? "");
	const [status, setStatus] = useState<ArticleStatus>(
		initial?.status ?? ArticleStatus.DRAFT,
	);
	const [publishedAt, setPublishedAt] = useState<string>(
		initial?.publishedAt ? toDatetimeLocal(initial.publishedAt) : "",
	);
	const [coverImageId, setCoverImageId] = useState<string | null>(
		initial?.coverImageId ?? null,
	);
	const [coverImagePreviewUrl, setCoverImagePreviewUrl] = useState<
		string | null
	>(initial?.coverImageUrl ?? null);
	const [coverImageAlt, setCoverImageAlt] = useState(
		initial?.coverImageAlt ?? "",
	);
	const [metaTitle, setMetaTitle] = useState(initial?.metaTitle ?? "");
	const [metaDescription, setMetaDescription] = useState(
		initial?.metaDescription ?? "",
	);
	const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);

	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [coverUploading, setCoverUploading] = useState(false);
	const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
	const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	const createMutation = api.articles.create.useMutation();
	const updateMutation = api.articles.update.useMutation();
	const setStatusMutation = api.articles.setStatus.useMutation();
	const deleteMutation = api.articles.delete.useMutation();
	// Phase 15 Step 6 — refactored from api.articles.uploadImage to the shared
	// contentImage router.
	const uploadImageMutation = api.contentImage.upload.useMutation();

	const saving =
		createMutation.isPending ||
		updateMutation.isPending ||
		setStatusMutation.isPending ||
		deleteMutation.isPending;

	const handleTitleChange = (next: string) => {
		setTitle(next);
		if (!slugManuallyEdited) {
			setSlug(slugify(next));
		}
	};

	const handleSlugChange = (next: string) => {
		setSlug(next);
		// Clearing the slug resumes title→slug auto-sync (matches the hint).
		setSlugManuallyEdited(next.trim() !== "");
	};

	const handleCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (e.target) e.target.value = "";
		if (!file) return;

		setCoverUploading(true);
		setCoverUploadError(null);
		try {
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});
			const commaIdx = dataUrl.indexOf(",");
			const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

			const result = await uploadImageMutation.mutateAsync({
				base64,
				mimeType: file.type,
				alt: coverImageAlt || "",
			});

			setCoverImageId(result.id);
			setCoverImagePreviewUrl(CONTENT_IMAGE_URL(result.id));
		} catch (err) {
			setCoverUploadError(
				err instanceof Error ? err.message : "Failed to upload image",
			);
		} finally {
			setCoverUploading(false);
		}
	};

	const removeCover = () => {
		setCoverImageId(null);
		setCoverImagePreviewUrl(null);
	};

	const buildPayload = (
		nextStatus: ArticleStatus,
	):
		| {
				ok: true;
				value: {
					title: string;
					slug?: string;
					excerpt?: string;
					bodyHtml: string;
					status: ArticleStatus;
					publishedAt?: Date;
					coverImageId: string | null;
					metaTitle?: string;
					metaDescription?: string;
					tagIds: string[];
				};
		  }
		| { ok: false; error: string } => {
		if (!title.trim()) {
			return { ok: false, error: "Title is required" };
		}
		const publishedAtDate =
			publishedAt.trim().length > 0 ? new Date(publishedAt) : undefined;
		if (
			publishedAt.trim().length > 0 &&
			publishedAtDate &&
			Number.isNaN(publishedAtDate.getTime())
		) {
			return { ok: false, error: "Invalid publish date" };
		}
		return {
			ok: true,
			value: {
				title: title.trim(),
				slug: slug.trim() || undefined,
				excerpt: excerpt.trim() || undefined,
				bodyHtml,
				status: nextStatus,
				publishedAt: publishedAtDate,
				coverImageId,
				metaTitle: metaTitle.trim() || undefined,
				metaDescription: metaDescription.trim() || undefined,
				tagIds,
			},
		};
	};

	const handleSave = async (nextStatus: ArticleStatus) => {
		if (readOnly) return;
		setFormError(null);
		setSaveSuccess(null);

		const built = buildPayload(nextStatus);
		if (!built.ok) {
			setFormError(built.error);
			return;
		}

		try {
			if (isEdit && initial) {
				// Q8: scope is locked on update — do not send clubShortName.
				await updateMutation.mutateAsync({
					id: initial.id,
					...built.value,
				});
				setStatus(nextStatus);
				void utils.articles.adminGetById.invalidate({ id: initial.id });
				void utils.articles.adminList.invalidate();
				setSaveSuccess("Saved");
				toast("Article saved", "success");
			} else {
				// Create: include resolved scope.
				const result = await createMutation.mutateAsync({
					...built.value,
					clubShortName: resolvedClubShortName,
				});
				void utils.articles.adminList.invalidate();
				toast("Article created", "success");
				router.push(`/admin/articles/${result.id}/edit`);
			}
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to save article";
			setFormError(message);
			toast(message, "error");
		}
	};

	const handleUnpublish = async () => {
		if (!initial || readOnly) return;
		setFormError(null);
		setSaveSuccess(null);
		try {
			await setStatusMutation.mutateAsync({
				id: initial.id,
				status: ArticleStatus.DRAFT,
			});
			setStatus(ArticleStatus.DRAFT);
			void utils.articles.adminGetById.invalidate({ id: initial.id });
			void utils.articles.adminList.invalidate();
			toast("Article unpublished", "success");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to unpublish article";
			setFormError(message);
			toast(message, "error");
		}
	};

	const handleDelete = async () => {
		if (!initial || readOnly) return;
		if (!confirm(`Delete "${initial.title}"? This cannot be undone.`)) {
			return;
		}
		setFormError(null);
		try {
			await deleteMutation.mutateAsync({ id: initial.id });
			void utils.articles.adminList.invalidate();
			toast("Article deleted", "success");
			router.push("/admin/articles");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to delete article";
			setFormError(message);
			toast(message, "error");
		}
	};

	// Slug URL preview (live).
	const slugPlaceholder = slug.trim() || slugify(title) || "your-slug-here";
	const slugUrlPreview =
		scope === "PLATFORM"
			? `facilitypresence.com/articles/${slugPlaceholder}`
			: `facilitypresence.com/${scope}/articles/${slugPlaceholder}`;

	// Disable fields when in read-only mode.
	const disabled = readOnly;

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6">
				<Link
					href="/admin/articles"
					className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to articles
				</Link>
			</div>

			<div className="mb-6 flex items-center justify-between">
				<h1 className="font-bold text-2xl">
					{isEdit ? "Edit article" : "New article"}
				</h1>
				<span
					className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${
						status === ArticleStatus.PUBLISHED
							? "bg-green-100 text-green-800"
							: "bg-gray-100 text-gray-700"
					}`}
				>
					{status === ArticleStatus.PUBLISHED ? "Published" : "Draft"}
				</span>
			</div>

			{readOnly && (
				<div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
					View only — you don't have edit access to this article. Only the
					author or a club admin can edit.
				</div>
			)}

			{/* Scope picker — new posts only */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">Scope</div>
				{!isEdit && isPlatformAdmin ? (
					<>
						<select
							value={scope}
							onChange={(e) => setScope(e.target.value)}
							className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
						>
							<option value="PLATFORM">Platform (facilitypresence.com)</option>
							{clubsAvailable.map((c) => (
								<option key={c.clubShortName} value={c.clubShortName}>
									{c.clubName} ({c.clubShortName})
								</option>
							))}
						</select>
						<p className="mt-1 text-muted-foreground text-xs">
							Scope is locked after creation.
						</p>
					</>
				) : (
					<div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-3 py-1.5 text-sm">
						<Lock className="h-3 w-3 text-muted-foreground" />
						<span>
							{isEdit ? "Published as " : "Publishing as "}
							<strong>{scopeBadgeText()}</strong>
						</span>
					</div>
				)}
			</div>

			{/* Title */}
			<div className="mb-4">
				<label
					htmlFor="article-title"
					className="mb-1.5 block font-medium text-sm"
				>
					Title
				</label>
				<input
					id="article-title"
					type="text"
					value={title}
					onChange={(e) => handleTitleChange(e.target.value)}
					disabled={disabled}
					placeholder="Article title…"
					className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
					maxLength={TITLE_MAX}
				/>
			</div>

			{/* Slug */}
			<div className="mb-4">
				<label
					htmlFor="article-slug"
					className="mb-1.5 block font-medium text-sm"
				>
					Slug
				</label>
				<input
					id="article-slug"
					type="text"
					value={slug}
					onChange={(e) => handleSlugChange(e.target.value)}
					disabled={disabled}
					placeholder="auto-generated-from-title"
					className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
					maxLength={SLUG_MAX}
				/>
				<p className="mt-1 font-mono text-muted-foreground text-xs">
					{slugUrlPreview}
				</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					{slugManuallyEdited
						? "Slug is locked. Clear it and edit the title to regenerate."
						: "Auto-generated from title."}
				</p>
			</div>

			{/* Excerpt */}
			<div className="mb-4">
				<label
					htmlFor="article-excerpt"
					className="mb-1.5 block font-medium text-sm"
				>
					Excerpt
				</label>
				<textarea
					id="article-excerpt"
					value={excerpt}
					onChange={(e) => setExcerpt(e.target.value)}
					disabled={disabled}
					placeholder="Short summary shown in lists and previews."
					rows={3}
					className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
					maxLength={EXCERPT_MAX}
				/>
				<p className="mt-1 text-right text-muted-foreground text-xs">
					{excerpt.length}/{EXCERPT_MAX}
				</p>
			</div>

			{/* Cover image */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">Cover image</div>
				{coverImagePreviewUrl ? (
					<div className="space-y-2">
						<img
							src={coverImagePreviewUrl}
							alt={coverImageAlt || "Cover preview"}
							className="max-h-64 w-full rounded-md border object-cover"
						/>
						{!disabled && (
							<div className="flex items-center gap-2">
								<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
									Replace
									<input
										type="file"
										accept="image/*"
										hidden
										onChange={handleCoverFile}
									/>
								</label>
								<button
									type="button"
									onClick={removeCover}
									className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
								>
									<X className="h-4 w-4" />
									Remove
								</button>
								{coverUploading && (
									<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
								)}
							</div>
						)}
					</div>
				) : (
					!disabled && (
						<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent">
							{coverUploading ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									Uploading…
								</>
							) : (
								"Upload cover image"
							)}
							<input
								type="file"
								accept="image/*"
								hidden
								onChange={handleCoverFile}
								disabled={coverUploading}
							/>
						</label>
					)
				)}
				{coverUploadError && (
					<p className="mt-1 text-destructive text-sm">{coverUploadError}</p>
				)}
			</div>

			{/* Tags */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">Tags</div>
				<TagPicker
					value={tagIds}
					onChange={setTagIds}
					clubShortName={resolvedClubShortName}
				/>
			</div>

			{/* Body */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">Body</div>
				<RichTextEditor
					value={bodyHtml}
					onChange={setBodyHtml}
					placeholder="Write your article…"
					minHeightPx={320}
				/>
			</div>

			{/* Publish date */}
			<div className="mb-4">
				<label
					htmlFor="article-published-at"
					className="mb-1.5 block font-medium text-sm"
				>
					Publish date{" "}
					<span className="text-muted-foreground text-xs">
						(optional — defaults to now on first publish)
					</span>
				</label>
				<input
					id="article-published-at"
					type="datetime-local"
					value={publishedAt}
					onChange={(e) => setPublishedAt(e.target.value)}
					disabled={disabled}
					className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
				/>
			</div>

			{/* Advanced */}
			<div className="mb-6 rounded-md border">
				<button
					type="button"
					onClick={() => setAdvancedOpen((v) => !v)}
					className="flex w-full items-center justify-between px-3 py-2 text-left font-medium text-sm hover:bg-accent"
				>
					<span>SEO / Advanced</span>
					{advancedOpen ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
				</button>
				{advancedOpen && (
					<div className="space-y-4 border-t p-3">
						<div>
							<label
								htmlFor="article-meta-title"
								className="mb-1.5 block font-medium text-sm"
							>
								Meta title
							</label>
							<input
								id="article-meta-title"
								type="text"
								value={metaTitle}
								onChange={(e) => setMetaTitle(e.target.value)}
								disabled={disabled}
								placeholder="Used for <title> and social cards (defaults to article title)"
								className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
								maxLength={META_TITLE_MAX}
							/>
							<p className="mt-1 text-right text-muted-foreground text-xs">
								{metaTitle.length}/{META_TITLE_MAX}
							</p>
						</div>
						<div>
							<label
								htmlFor="article-meta-description"
								className="mb-1.5 block font-medium text-sm"
							>
								Meta description
							</label>
							<textarea
								id="article-meta-description"
								value={metaDescription}
								onChange={(e) => setMetaDescription(e.target.value)}
								disabled={disabled}
								placeholder="Used for search results and social cards (defaults to excerpt)"
								rows={3}
								className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
								maxLength={META_DESCRIPTION_MAX}
							/>
							<p className="mt-1 text-right text-muted-foreground text-xs">
								{metaDescription.length}/{META_DESCRIPTION_MAX}
							</p>
						</div>
						<div>
							<label
								htmlFor="article-cover-alt"
								className="mb-1.5 block font-medium text-sm"
							>
								Cover image alt text
							</label>
							<input
								id="article-cover-alt"
								type="text"
								value={coverImageAlt}
								onChange={(e) => setCoverImageAlt(e.target.value)}
								disabled={disabled || coverImageId !== null}
								title={
									coverImageId !== null
										? "Alt text is set on the image when uploaded. To change it, remove the cover and re-upload."
										: undefined
								}
								placeholder="Describe the cover image for accessibility"
								className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted"
								maxLength={300}
							/>
							<p className="mt-1 text-muted-foreground text-xs">
								Alt text is set on the cover image at upload time. Remove the
								cover and re-upload to change it.
							</p>
						</div>
					</div>
				)}
			</div>

			{/* Errors / success */}
			{formError && (
				<p className="mb-4 text-destructive text-sm">{formError}</p>
			)}
			{saveSuccess && (
				<p className="mb-4 text-green-600 text-sm">{saveSuccess}</p>
			)}

			{/* Actions — hidden in read-only mode */}
			{!disabled && (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						{isEdit && (
							<button
								type="button"
								onClick={handleDelete}
								disabled={saving}
								className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-destructive text-sm hover:bg-destructive/10 disabled:opacity-50"
							>
								<Trash2 className="h-4 w-4" />
								Delete
							</button>
						)}
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void handleSave(ArticleStatus.DRAFT)}
							disabled={saving}
							className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
						>
							<Save className="h-4 w-4" />
							{saving ? "Saving…" : "Save draft"}
						</button>
						{isEdit && status === ArticleStatus.PUBLISHED ? (
							<button
								type="button"
								onClick={() => void handleUnpublish()}
								disabled={saving}
								className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
							>
								Unpublish
							</button>
						) : (
							<button
								type="button"
								onClick={() => void handleSave(ArticleStatus.PUBLISHED)}
								disabled={saving}
								className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
							>
								<Send className="h-4 w-4" />
								{saving ? "Saving…" : "Publish"}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// Render a Date in the local time format expected by <input type="datetime-local">.
function toDatetimeLocal(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const y = date.getFullYear();
	const m = pad(date.getMonth() + 1);
	const d = pad(date.getDate());
	const hh = pad(date.getHours());
	const mm = pad(date.getMinutes());
	return `${y}-${m}-${d}T${hh}:${mm}`;
}
