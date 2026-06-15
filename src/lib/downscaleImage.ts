/**
 * Lightweight, dependency-free client-side image downscaling.
 *
 * Loads a File into an <img>, draws it to a <canvas> at a capped longest-side
 * dimension, and re-encodes it. PNG inputs stay PNG (to preserve transparency);
 * everything else is re-encoded as WebP (with a JPEG fallback for browsers that
 * can't encode WebP). Returns the raw base64 payload (no `data:...;base64,`
 * prefix) to match what `contentImage.upload` expects.
 */

export type DownscaleOptions = {
	/** Longest side of the output in pixels. Images smaller than this are kept at their natural size. */
	maxDimension: number;
};

import type { AllowedContentImageMimeType } from "~/lib/article";

export type DownscaleResult = {
	/** Base64 payload only — the `data:<mime>;base64,` prefix has been stripped. */
	base64: string;
	/** The MIME type the image was re-encoded to — always a ContentImage-allowed format. */
	mimeType: AllowedContentImageMimeType;
};

/** Quality used for lossy (WebP / JPEG) re-encoding. */
const LOSSY_QUALITY = 0.85;

/** Strip the `data:<mime>;base64,` prefix from a data URL, returning the payload. */
function stripDataUrlPrefix(dataUrl: string): string {
	const commaIdx = dataUrl.indexOf(",");
	return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

/** Load a File into a fully-decoded HTMLImageElement, revoking the object URL when done. */
function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Failed to load image"));
		};
		img.src = url;
	});
}

export async function downscaleImage(
	file: File,
	opts: DownscaleOptions,
): Promise<DownscaleResult> {
	const img = await loadImage(file);

	const naturalWidth = img.naturalWidth || img.width;
	const naturalHeight = img.naturalHeight || img.height;
	if (!naturalWidth || !naturalHeight) {
		throw new Error("Image has no dimensions");
	}

	// Scale down proportionally so the longest side equals maxDimension; never
	// scale up.
	const longest = Math.max(naturalWidth, naturalHeight);
	const scale = longest > opts.maxDimension ? opts.maxDimension / longest : 1;
	const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
	const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

	const canvas = document.createElement("canvas");
	canvas.width = targetWidth;
	canvas.height = targetHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Could not get 2D canvas context");
	}
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

	// Preserve PNG (and its transparency); otherwise prefer WebP, falling back to
	// JPEG when the browser can't encode WebP.
	const isPng = file.type === "image/png";
	let mimeType: AllowedContentImageMimeType;
	let dataUrl: string;
	if (isPng) {
		mimeType = "image/png";
		dataUrl = canvas.toDataURL(mimeType);
	} else {
		const webp = canvas.toDataURL("image/webp", LOSSY_QUALITY);
		if (webp.startsWith("data:image/webp")) {
			mimeType = "image/webp";
			dataUrl = webp;
		} else {
			mimeType = "image/jpeg";
			dataUrl = canvas.toDataURL("image/jpeg", LOSSY_QUALITY);
		}
	}

	return { base64: stripDataUrlPrefix(dataUrl), mimeType };
}
