/**
 * Phase 9b — PDF stylesheet (server-only).
 *
 * Uses @react-pdf/renderer's StyleSheet primitive. The vocabulary is a
 * STRICT subset of flexbox-CSS — no media queries, no calc(), no shadows
 * beyond the supported few. Keep values literal numbers (points) so
 * @react-pdf can lay them out predictably; the page is US Letter at 72 DPI.
 *
 * Fonts: defaults to Noto Sans (Regular + Bold) bundled via
 * `@expo-google-fonts/noto-sans`. Noto Sans covers Latin + Latin-extended
 * (à, é, ñ, ø, ü, ç, ł, etc.), so member names like "José Pérez",
 * "Müller", "Łukasz", "Hernández" render correctly. The mono money column
 * still uses the PDF built-in Courier (digits-only — safe).
 *
 * KNOWN LIMITATION — characters OUTSIDE Latin-extended:
 *   CJK ("张伟"), Arabic ("محمد"), Devanagari ("नितेश"), Thai, Hebrew, and
 *   emoji are NOT covered by Noto Sans alone and will render as blank
 *   boxes. react-pdf has no auto-font-fallback, so adding e.g.
 *   `@expo-google-fonts/noto-sans-sc` registered under a second family
 *   won't help unless we route specific Texts to that family by detecting
 *   the script per-string. Follow-up: if members with CJK or other
 *   non-Latin names appear in production, either (a) swap the default to
 *   a broader-coverage single font (Noto Sans SC includes Latin glyphs,
 *   though Han-flavored) or (b) build a per-Text script detector.
 */

import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";

// ---------- Font registration ----------
//
// react-pdf's Font.register accepts TTF only. `@expo-google-fonts/noto-sans`
// ships per-weight TTFs at predictable paths under node_modules — load
// Regular (400) and Bold (700) once at module init. `process.cwd()` is the
// Next.js app root in both `next dev` and `next start`, so this resolves
// correctly under Docker and on a developer's laptop.
Font.register({
	family: "Noto Sans",
	fonts: [
		{
			src: path.join(
				process.cwd(),
				"node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
			),
			fontWeight: 400,
		},
		{
			src: path.join(
				process.cwd(),
				"node_modules/@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf",
			),
			fontWeight: 700,
		},
	],
});

// ---------- Hyphenation: force-break very long unspaced tokens ----------
//
// react-pdf's default line-breaker only splits on whitespace. A 200-char URL
// or SKU in a line-item description would otherwise overflow the column edge
// and get clipped at the page boundary (FIX 7). Register a global
// hyphenation callback that returns each word as-is when short, but slices
// long tokens into 40-character chunks so the renderer can wrap them.
// This applies globally to every <Text> in every Document, which is
// acceptable here since the invoice document is the only react-pdf surface
// in this app today.
const MAX_TOKEN_LEN = 40;
Font.registerHyphenationCallback((word: string) => {
	if (word.length <= MAX_TOKEN_LEN) return [word];
	const chunks: string[] = [];
	for (let i = 0; i < word.length; i += MAX_TOKEN_LEN) {
		chunks.push(word.slice(i, i + MAX_TOKEN_LEN));
	}
	return chunks;
});

export const COLORS = {
	ink: "#0F172A", // slate-900
	mutedInk: "#475569", // slate-600
	faintInk: "#94A3B8", // slate-400
	border: "#E2E8F0", // slate-200
	pillBg: "#F1F5F9", // slate-100
	successInk: "#047857", // emerald-700
	warnInk: "#B45309", // amber-700
	neutralInk: "#1E3A8A", // blue-900
};

export const styles = StyleSheet.create({
	page: {
		paddingTop: 48,
		paddingBottom: 56,
		paddingHorizontal: 48,
		fontFamily: "Noto Sans",
		fontSize: 10,
		color: COLORS.ink,
		lineHeight: 1.35,
	},
	// ---------- Header ----------
	headerRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "flex-start",
		marginBottom: 24,
	},
	fromBlock: {
		maxWidth: "55%",
	},
	clubName: {
		fontSize: 16,
		fontFamily: "Noto Sans",
		fontWeight: 700,
		marginBottom: 4,
	},
	facilityLine: {
		color: COLORS.mutedInk,
		marginBottom: 2,
	},
	headerRight: {
		alignItems: "flex-end",
	},
	invoiceTitle: {
		fontSize: 20,
		fontFamily: "Noto Sans",
		fontWeight: 700,
		marginBottom: 6,
	},
	statusPill: {
		paddingHorizontal: 8,
		paddingVertical: 2,
		borderRadius: 999,
		backgroundColor: COLORS.pillBg,
		fontSize: 9,
		fontFamily: "Noto Sans",
		fontWeight: 700,
		marginBottom: 6,
	},
	invoiceMetaLine: {
		color: COLORS.mutedInk,
		fontSize: 9,
	},
	// ---------- Parties block ----------
	partiesRow: {
		flexDirection: "row",
		gap: 16,
		marginBottom: 18,
	},
	partyCard: {
		flex: 1,
		borderWidth: 1,
		borderColor: COLORS.border,
		borderRadius: 6,
		padding: 10,
	},
	partyLabel: {
		fontSize: 8,
		color: COLORS.mutedInk,
		marginBottom: 4,
		textTransform: "uppercase",
		letterSpacing: 0.5,
	},
	partyName: {
		fontFamily: "Noto Sans",
		fontWeight: 700,
		marginBottom: 2,
	},
	partyDetail: {
		color: COLORS.mutedInk,
		fontSize: 9,
	},
	// ---------- Line-items table ----------
	table: {
		marginBottom: 14,
		borderWidth: 1,
		borderColor: COLORS.border,
		borderRadius: 6,
		// react-pdf doesn't clip child borders to a rounded parent, but the
		// outer rounded box still reads as a single grouped element.
	},
	tableHeader: {
		flexDirection: "row",
		backgroundColor: COLORS.pillBg,
		paddingVertical: 6,
		paddingHorizontal: 8,
		borderBottomWidth: 1,
		borderBottomColor: COLORS.border,
		fontFamily: "Noto Sans",
		fontWeight: 700,
		fontSize: 9,
		color: COLORS.mutedInk,
	},
	tableRow: {
		flexDirection: "row",
		paddingVertical: 6,
		paddingHorizontal: 8,
		borderBottomWidth: 1,
		borderBottomColor: COLORS.border,
		alignItems: "flex-start",
	},
	tableRowLast: {
		borderBottomWidth: 0,
	},
	// Column widths sum to 100. Tax column is conditionally rendered.
	colDescription: { flexBasis: "52%" },
	colDescriptionWithTax: { flexBasis: "40%" },
	colQty: { flexBasis: "8%", textAlign: "right" },
	colUnit: { flexBasis: "16%", textAlign: "right" },
	colTax: { flexBasis: "12%", textAlign: "right" },
	colAmount: { flexBasis: "24%", textAlign: "right" },
	descCell: {
		flexDirection: "column",
	},
	descMain: {
		flexDirection: "row",
		gap: 6,
		alignItems: "center",
		marginBottom: 1,
	},
	descText: {
		// Lets the description Text shrink to its column's width rather
		// than push past the column edge. Combined with the row no longer
		// being `wrap={false}` AND the module-level hyphenation callback
		// above (which chunks long unspaced tokens), a 200-char URL or SKU
		// in a description wraps and paginates cleanly.
		flexShrink: 1,
	},
	descKindPill: {
		fontSize: 7,
		color: COLORS.mutedInk,
		backgroundColor: COLORS.pillBg,
		paddingHorizontal: 4,
		paddingVertical: 1,
		borderRadius: 3,
	},
	descSubtle: {
		fontSize: 8,
		color: COLORS.mutedInk,
		marginTop: 2,
	},
	mono: {
		fontFamily: "Courier",
	},
	// ---------- Totals block ----------
	totalsBlock: {
		alignSelf: "flex-end",
		width: 240,
		marginBottom: 20,
	},
	totalsRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		paddingVertical: 2,
	},
	totalsRowBold: {
		fontFamily: "Noto Sans",
		fontWeight: 700,
		borderTopWidth: 1,
		borderTopColor: COLORS.border,
		paddingTop: 4,
		marginTop: 2,
	},
	totalsLabelMuted: { color: COLORS.mutedInk },
	// ---------- Payments block ----------
	sectionTitle: {
		fontFamily: "Noto Sans",
		fontWeight: 700,
		fontSize: 11,
		marginBottom: 6,
		marginTop: 8,
	},
	paymentRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomColor: COLORS.border,
		paddingVertical: 5,
	},
	paymentRowLast: {
		borderBottomWidth: 0,
	},
	paymentLeft: {
		flexDirection: "column",
		flexBasis: "70%",
	},
	paymentRight: {
		flexDirection: "column",
		flexBasis: "30%",
		alignItems: "flex-end",
	},
	// ---------- Footer (fixed on every page) ----------
	footer: {
		position: "absolute",
		bottom: 24,
		left: 48,
		right: 48,
		fontSize: 8,
		color: COLORS.faintInk,
		flexDirection: "row",
		justifyContent: "space-between",
		borderTopWidth: 1,
		borderTopColor: COLORS.border,
		paddingTop: 6,
	},
	footerText: {},
	notesBlock: {
		marginTop: 6,
		marginBottom: 12,
		padding: 8,
		borderWidth: 1,
		borderColor: COLORS.border,
		borderRadius: 6,
	},
	notesText: {
		color: COLORS.mutedInk,
	},
	voidWatermarkContainer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		alignItems: "center",
		justifyContent: "center",
	},
	voidWatermarkText: {
		fontSize: 90,
		color: "#FCA5A5",
		opacity: 0.35,
		transform: "rotate(-30deg)",
		fontFamily: "Noto Sans",
		fontWeight: 700,
	},
});

export function statusPillColor(
	tone: "success" | "warn" | "neutral" | "muted",
): string {
	switch (tone) {
		case "success":
			return COLORS.successInk;
		case "warn":
			return COLORS.warnInk;
		case "neutral":
			return COLORS.neutralInk;
		default:
			return COLORS.mutedInk;
	}
}
