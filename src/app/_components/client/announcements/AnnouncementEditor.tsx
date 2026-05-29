"use client";

import { AnnouncementStatus } from "@prisma/client";
import { ArrowLeft, Loader2, Lock, Save, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import RichTextEditor from "~/app/_components/client/shared/RichTextEditor";
import { useToast } from "~/app/_components/shared/Toast";
import type { AdminAnnouncementDetail } from "~/lib/announcement";
import { CONTENT_IMAGE_URL } from "~/lib/article";
import { api } from "~/trpc/react";

const TITLE_MAX = 200;

interface AnnouncementEditorProps {
	initial?: AdminAnnouncementDetail;
	currentUser: {
		userId: string;
		userType: string;
		clubShortName: string;
		firstName: string | null;
		lastName: string | null;
	};
	clubsAvailable: { clubShortName: string; clubName: string }[];
}

export default function AnnouncementEditor({
	initial,
	currentUser,
	clubsAvailable,
}: AnnouncementEditorProps) {
	const router = useRouter();
	const utils = api.useUtils();
	const { toast } = useToast();

	const isEdit = Boolean(initial);
	const isPlatformAdmin = currentUser.userType === "PLATFORM_ADMIN";

	// ─── Scope state ──────────────────────────────────────────────────────────
	// Announcements are ALWAYS per-club (unlike articles which have a Platform
	// option). For new posts: PLATFORM_ADMIN picks a club from a dropdown;
	// other staff are forced to their own club. For existing posts the scope
	// is locked (Q8 — clubShortName is stripped on update by the router).
	const initialClubShortName: string = (() => {
		if (initial) return initial.clubShortName;
		if (isPlatformAdmin) {
			return clubsAvailable[0]?.clubShortName ?? currentUser.clubShortName;
		}
		return currentUser.clubShortName;
	})();
	const [clubShortName, setClubShortName] =
		useState<string>(initialClubShortName);

	const clubNameByShort = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of clubsAvailable) m.set(c.clubShortName, c.clubName);
		return m;
	}, [clubsAvailable]);

	const scopeBadgeText = (): string =>
		clubNameByShort.get(clubShortName) ?? clubShortName;

	// ─── Field state ──────────────────────────────────────────────────────────

	const [title, setTitle] = useState(initial?.title ?? "");
	const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? "");
	const [status, setStatus] = useState<AnnouncementStatus>(
		initial?.status ?? AnnouncementStatus.DRAFT,
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

	const [coverUploading, setCoverUploading] = useState(false);
	const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
	const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	const createMutation = api.announcements.create.useMutation();
	const updateMutation = api.announcements.update.useMutation();
	const setStatusMutation = api.announcements.setStatus.useMutation();
	const deleteMutation = api.announcements.delete.useMutation();
	const uploadImageMutation = api.contentImage.upload.useMutation();

	const saving =
		createMutation.isPending ||
		updateMutation.isPending ||
		setStatusMutation.isPending ||
		deleteMutation.isPending;

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
		nextStatus: AnnouncementStatus,
	):
		| {
				ok: true;
				value: {
					title?: string;
					bodyHtml: string;
					status: AnnouncementStatus;
					publishedAt?: Date;
					coverImageId: string | null;
				};
		  }
		| { ok: false; error: string } => {
		if (!bodyHtml.trim() || bodyHtml.trim() === "<p></p>") {
			return { ok: false, error: "Body is required" };
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
				title: title.trim() || undefined,
				bodyHtml,
				status: nextStatus,
				publishedAt: publishedAtDate,
				coverImageId,
			},
		};
	};

	const handleSave = async (nextStatus: AnnouncementStatus) => {
		setFormError(null);
		setSaveSuccess(null);

		const built = buildPayload(nextStatus);
		if (!built.ok) {
			setFormError(built.error);
			return;
		}

		try {
			if (isEdit && initial) {
				// Q8: scope is locked on update — do not send clubShortName (the
				// router strips it regardless, but keeping it out of the payload
				// is clearer).
				await updateMutation.mutateAsync({
					id: initial.id,
					...built.value,
				});
				setStatus(nextStatus);
				void utils.announcements.adminGetById.invalidate({ id: initial.id });
				void utils.announcements.adminList.invalidate();
				setSaveSuccess("Saved");
				toast("Announcement saved", "success");
			} else {
				const result = await createMutation.mutateAsync({
					...built.value,
					clubShortName,
				});
				void utils.announcements.adminList.invalidate();
				toast("Announcement created", "success");
				router.push(`/admin/announcements/${result.id}/edit`);
			}
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to save announcement";
			setFormError(message);
			toast(message, "error");
		}
	};

	const handleUnpublish = async () => {
		if (!initial) return;
		setFormError(null);
		setSaveSuccess(null);
		try {
			await setStatusMutation.mutateAsync({
				id: initial.id,
				status: AnnouncementStatus.DRAFT,
			});
			setStatus(AnnouncementStatus.DRAFT);
			void utils.announcements.adminGetById.invalidate({ id: initial.id });
			void utils.announcements.adminList.invalidate();
			toast("Announcement unpublished", "success");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to unpublish announcement";
			setFormError(message);
			toast(message, "error");
		}
	};

	const handleDelete = async () => {
		if (!initial) return;
		const label = initial.title ?? "this announcement";
		if (!confirm(`Delete "${label}"? This cannot be undone.`)) {
			return;
		}
		setFormError(null);
		try {
			await deleteMutation.mutateAsync({ id: initial.id });
			void utils.announcements.adminList.invalidate();
			toast("Announcement deleted", "success");
			router.push("/admin/announcements");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to delete announcement";
			setFormError(message);
			toast(message, "error");
		}
	};

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6">
				<Link
					href="/admin/announcements"
					className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to announcements
				</Link>
			</div>

			<div className="mb-6 flex items-center justify-between">
				<h1 className="font-bold text-2xl">
					{isEdit ? "Edit announcement" : "New announcement"}
				</h1>
				<span
					className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${
						status === AnnouncementStatus.PUBLISHED
							? "bg-green-100 text-green-800"
							: "bg-gray-100 text-gray-700"
					}`}
				>
					{status === AnnouncementStatus.PUBLISHED ? "Published" : "Draft"}
				</span>
			</div>

			{/* Scope picker — new posts only. NO "Platform" option (announcements always per-club). */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">Club</div>
				{!isEdit && isPlatformAdmin ? (
					<>
						<select
							value={clubShortName}
							onChange={(e) => setClubShortName(e.target.value)}
							className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
						>
							{clubsAvailable.map((c) => (
								<option key={c.clubShortName} value={c.clubShortName}>
									{c.clubName} ({c.clubShortName})
								</option>
							))}
						</select>
						<p className="mt-1 text-muted-foreground text-xs">
							Club is locked after creation.
						</p>
					</>
				) : (
					<div className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-3 py-1.5 text-sm">
						<Lock className="h-3 w-3 text-muted-foreground" />
						<span>
							{isEdit ? "Published to " : "Publishing to "}
							<strong>{scopeBadgeText()}</strong>
						</span>
					</div>
				)}
			</div>

			{/* Title (optional) */}
			<div className="mb-4">
				<label
					htmlFor="announcement-title"
					className="mb-1.5 block font-medium text-sm"
				>
					Title{" "}
					<span className="text-muted-foreground text-xs">(optional)</span>
				</label>
				<input
					id="announcement-title"
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Optional headline…"
					className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
					maxLength={TITLE_MAX}
				/>
				<p className="mt-1 text-muted-foreground text-xs">
					Short notices don't need a title.
				</p>
			</div>

			{/* Cover image */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">
					Cover image{" "}
					<span className="text-muted-foreground text-xs">(optional)</span>
				</div>
				{coverImagePreviewUrl ? (
					<div className="space-y-2">
						<img
							src={coverImagePreviewUrl}
							alt={coverImageAlt || "Cover preview"}
							className="max-h-64 w-full rounded-md border object-cover"
						/>
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
					</div>
				) : (
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
				)}
				{coverUploadError && (
					<p className="mt-1 text-destructive text-sm">{coverUploadError}</p>
				)}
			</div>

			{/* Body */}
			<div className="mb-4">
				<div className="mb-1.5 block font-medium text-sm">Body</div>
				<RichTextEditor
					value={bodyHtml}
					onChange={setBodyHtml}
					placeholder="Write your announcement…"
					minHeightPx={240}
				/>
			</div>

			{/* Publish date */}
			<div className="mb-6">
				<label
					htmlFor="announcement-published-at"
					className="mb-1.5 block font-medium text-sm"
				>
					Publish date{" "}
					<span className="text-muted-foreground text-xs">
						(optional — defaults to now on first publish)
					</span>
				</label>
				<input
					id="announcement-published-at"
					type="datetime-local"
					value={publishedAt}
					onChange={(e) => setPublishedAt(e.target.value)}
					className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
				/>
			</div>

			{/* Errors / success */}
			{formError && (
				<p className="mb-4 text-destructive text-sm">{formError}</p>
			)}
			{saveSuccess && (
				<p className="mb-4 text-green-600 text-sm">{saveSuccess}</p>
			)}

			{/* Actions */}
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
						onClick={() => void handleSave(AnnouncementStatus.DRAFT)}
						disabled={saving}
						className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
					>
						<Save className="h-4 w-4" />
						{saving ? "Saving…" : "Save draft"}
					</button>
					{isEdit && status === AnnouncementStatus.PUBLISHED ? (
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
							onClick={() => void handleSave(AnnouncementStatus.PUBLISHED)}
							disabled={saving}
							className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
						>
							<Send className="h-4 w-4" />
							{saving ? "Saving…" : "Publish"}
						</button>
					)}
				</div>
			</div>
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
