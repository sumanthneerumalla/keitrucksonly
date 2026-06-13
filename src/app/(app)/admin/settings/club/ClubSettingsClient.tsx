"use client";

import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import {
	ALLOWED_CONTENT_IMAGE_MIME_TYPES,
	CONTENT_IMAGE_URL,
	isAllowedContentImageMimeType,
} from "~/lib/article";
import { SOCIAL_PLATFORMS, type SocialLinks } from "~/lib/clubProfile";
import { api } from "~/trpc/react";

type SocialKey = keyof SocialLinks;

/** Empty string for every platform — the cleared form baseline. */
function emptySocials(): Record<SocialKey, string> {
	const out = {} as Record<SocialKey, string>;
	for (const { key } of SOCIAL_PLATFORMS) out[key] = "";
	return out;
}

export default function ClubSettingsClient() {
	const utils = api.useUtils();
	const { data: branding, isLoading } = api.clubSettings.getBranding.useQuery();

	// ─── Form state ─────────────────────────────────────────────────────────
	const [tagline, setTagline] = useState("");
	const [description, setDescription] = useState("");
	const [websiteUrl, setWebsiteUrl] = useState("");
	const [socials, setSocials] = useState<Record<SocialKey, string>>(
		emptySocials(),
	);
	const [canonicalDomain, setCanonicalDomain] = useState("");
	const [logoImageId, setLogoImageId] = useState<string | null>(null);
	const [heroImageId, setHeroImageId] = useState<string | null>(null);

	// Per-image upload UI state.
	const [logoUploading, setLogoUploading] = useState(false);
	const [heroUploading, setHeroUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const [saveSuccess, setSaveSuccess] = useState(false);

	// Initialize form once the query resolves. Keyed on the loaded record so a
	// refetch (e.g. after invalidate) re-seeds the inputs from the server truth.
	useEffect(() => {
		if (!branding) return;
		setTagline(branding.tagline ?? "");
		setDescription(branding.description ?? "");
		setWebsiteUrl(branding.websiteUrl ?? "");
		setCanonicalDomain(branding.canonicalDomain ?? "");
		setLogoImageId(branding.logoImageId ?? null);
		setHeroImageId(branding.heroImageId ?? null);

		// socialLinks is a Prisma Json column — narrow it to our known keys.
		const next = emptySocials();
		const raw = branding.socialLinks;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			for (const { key } of SOCIAL_PLATFORMS) {
				const value = (raw as Record<string, unknown>)[key];
				if (typeof value === "string") next[key] = value;
			}
		}
		setSocials(next);
	}, [branding]);

	const uploadImageMutation = api.contentImage.upload.useMutation();
	const updateMutation = api.clubSettings.updateBranding.useMutation();

	async function uploadImage(
		file: File,
		setUploading: (v: boolean) => void,
		onDone: (id: string) => void,
	) {
		// Friendly client-side MIME check before the server's zod enum rejects it.
		if (!isAllowedContentImageMimeType(file.type)) {
			setUploadError(
				`Unsupported image type. Allowed: ${ALLOWED_CONTENT_IMAGE_MIME_TYPES.join(", ")}.`,
			);
			return;
		}
		const mimeType = file.type;
		setUploading(true);
		setUploadError(null);
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
				mimeType,
				alt: "",
			});
			onDone(result.id);
		} catch (err) {
			setUploadError(
				err instanceof Error ? err.message : "Failed to upload image",
			);
		} finally {
			setUploading(false);
		}
	}

	function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (e.target) e.target.value = "";
		if (!file) return;
		void uploadImage(file, setLogoUploading, setLogoImageId);
	}

	function handleHeroFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (e.target) e.target.value = "";
		if (!file) return;
		void uploadImage(file, setHeroUploading, setHeroImageId);
	}

	function handleSave() {
		setSaveSuccess(false);

		// Build the socialLinks object from only the non-empty inputs; null when
		// every platform is blank.
		const socialLinks: SocialLinks = {};
		for (const { key } of SOCIAL_PLATFORMS) {
			const value = socials[key].trim();
			if (value) socialLinks[key] = value;
		}
		const hasSocial = Object.keys(socialLinks).length > 0;

		updateMutation.mutate(
			{
				tagline: tagline.trim() || null,
				description: description.trim() || null,
				websiteUrl: websiteUrl.trim(),
				socialLinks: hasSocial ? socialLinks : null,
				logoImageId,
				heroImageId,
				canonicalDomain: canonicalDomain.trim(),
			},
			{
				onSuccess: () => {
					setSaveSuccess(true);
					void utils.clubSettings.getBranding.invalidate();
				},
			},
		);
	}

	const isSaving = updateMutation.isPending;
	const error = updateMutation.error ?? null;

	return (
		<div className="p-6">
			<div className="mb-6">
				<Link
					href="/admin"
					className="text-[var(--muted-foreground)] text-sm hover:text-[var(--foreground)]"
				>
					← Admin
				</Link>
				<h1 className="mt-2 font-semibold text-2xl text-[var(--foreground)]">
					Club Branding
				</h1>
				{branding?.clubName && (
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						{branding.clubName}
					</p>
				)}
			</div>

			{isLoading ? (
				<div className="mx-auto max-w-2xl animate-pulse space-y-3">
					<div className="h-24 rounded-lg bg-gray-200" />
					<div className="h-24 rounded-lg bg-gray-200" />
					<div className="h-40 rounded-lg bg-gray-200" />
				</div>
			) : (
				<div className="mx-auto max-w-2xl space-y-6">
					{/* Logo */}
					<div className="glass-inset space-y-2 p-4">
						<p className="font-medium text-[var(--foreground)] text-sm">Logo</p>
						{logoImageId ? (
							<div className="space-y-2">
								<img
									src={CONTENT_IMAGE_URL(logoImageId)}
									alt="Club logo"
									className="max-h-32 rounded-md border object-contain"
								/>
								<div className="flex items-center gap-2">
									<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--accent)]">
										Replace
										<input
											type="file"
											accept="image/*"
											hidden
											onChange={handleLogoFile}
										/>
									</label>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setLogoImageId(null)}
									>
										<X size={14} />
										Remove
									</Button>
									{logoUploading && (
										<Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
									)}
								</div>
							</div>
						) : (
							<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-[var(--accent)]">
								{logoUploading ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										Uploading…
									</>
								) : (
									"Upload logo"
								)}
								<input
									type="file"
									accept="image/*"
									hidden
									onChange={handleLogoFile}
									disabled={logoUploading}
								/>
							</label>
						)}
					</div>

					{/* Hero photo */}
					<div className="glass-inset space-y-2 p-4">
						<p className="font-medium text-[var(--foreground)] text-sm">
							Hero photo
						</p>
						{heroImageId ? (
							<div className="space-y-2">
								<img
									src={CONTENT_IMAGE_URL(heroImageId)}
									alt="Club hero"
									className="max-h-48 w-full rounded-md border object-cover"
								/>
								<div className="flex items-center gap-2">
									<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--accent)]">
										Replace
										<input
											type="file"
											accept="image/*"
											hidden
											onChange={handleHeroFile}
										/>
									</label>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setHeroImageId(null)}
									>
										<X size={14} />
										Remove
									</Button>
									{heroUploading && (
										<Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
									)}
								</div>
							</div>
						) : (
							<label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-[var(--accent)]">
								{heroUploading ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										Uploading…
									</>
								) : (
									"Upload hero photo"
								)}
								<input
									type="file"
									accept="image/*"
									hidden
									onChange={handleHeroFile}
									disabled={heroUploading}
								/>
							</label>
						)}
					</div>

					{uploadError && <p className="text-red-500 text-xs">{uploadError}</p>}

					{/* Tagline */}
					<div>
						<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
							Tagline
						</label>
						<Input
							value={tagline}
							onChange={(e) => setTagline(e.target.value)}
							placeholder="A short slogan for your club"
							maxLength={200}
						/>
					</div>

					{/* Description */}
					<div>
						<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
							Description
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={6}
							maxLength={5000}
							placeholder="Tell visitors about your club"
							className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
						/>
						<p className="mt-1 text-[var(--muted-foreground)] text-xs">
							Shown on your public club page and used for search results.
						</p>
					</div>

					{/* Website */}
					<div>
						<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
							Website URL
						</label>
						<Input
							type="url"
							value={websiteUrl}
							onChange={(e) => setWebsiteUrl(e.target.value)}
							placeholder="https://yourclub.com"
						/>
					</div>

					{/* Social links */}
					<div className="space-y-3">
						<p className="font-medium text-[var(--foreground)] text-sm">
							Social links
						</p>
						{SOCIAL_PLATFORMS.map(({ key, label }) => (
							<div key={key}>
								<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
									{label}
								</label>
								<Input
									type="url"
									value={socials[key]}
									onChange={(e) =>
										setSocials((prev) => ({ ...prev, [key]: e.target.value }))
									}
									placeholder="https://…"
								/>
							</div>
						))}
					</div>

					{/* Advanced */}
					<div className="space-y-2">
						<p className="font-medium text-[var(--foreground)] text-sm">
							Advanced
						</p>
						<div>
							<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
								Canonical domain
							</label>
							<Input
								type="url"
								value={canonicalDomain}
								onChange={(e) => setCanonicalDomain(e.target.value)}
								placeholder="https://yourclub.com"
							/>
							<p className="mt-1 text-[var(--muted-foreground)] text-xs">
								Leave blank unless this club has its own domain. Changes every
								public URL for this club.
							</p>
						</div>
					</div>

					{error && <p className="text-red-500 text-xs">{error.message}</p>}
					{saveSuccess && <p className="text-green-600 text-xs">Saved</p>}

					<div className="flex gap-2">
						<Button
							onClick={handleSave}
							disabled={isSaving || logoUploading || heroUploading}
						>
							{isSaving ? "Saving…" : "Save"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
