/**
 * Phase 9b — InvoicePdfDocument.
 *
 * The @react-pdf/renderer component tree that prints a `RenderableInvoice`
 * to a PDF Buffer. Pure consumer of the DTO — no Prisma, no auth, no DB.
 *
 * Section ordering MIRRORS the on-screen InvoiceDetail.tsx (by convention,
 * see the doc-comment in ../types.ts). When you add a new section here,
 * add it to the web view too — and vice versa — to keep the two surfaces
 * coherent.
 *
 * Pagination: react-pdf flows content across pages automatically. The club
 * letterhead Header is NOT `fixed` — it prints only on page 1 (repeating the
 * letterhead on continuation pages is noisy). The line-items table column
 * header IS `fixed` so it repeats on each page the table spans (a >1-page
 * invoice keeps its Description/Qty/Amount labels). The page footer is also
 * `fixed`.
 *
 * Note on imports: this file is server-only. Never import it from a
 * client component — `@react-pdf/renderer` includes Node-only modules
 * (zlib, fontkit) that don't run in the browser.
 */

import { Document, Page, Text, View } from "@react-pdf/renderer";
// React is imported explicitly (rather than relying on Next.js's automatic
// JSX runtime) so this module also renders correctly when invoked outside
// the Next build pipeline — e.g. from background jobs or smoke tests.
// @react-pdf transforms JSX into reconciler calls that route through
// React.createElement at runtime, so the import has to be visible at the
// module's top scope.
import React from "react";
import {
	formatInvoiceDate,
	formatInvoiceDateTime,
	signedCents,
} from "~/lib/invoice/format";
import { formatCents } from "~/lib/money";
import type { RenderableInvoice } from "../types";
import { COLORS, statusPillColor, styles } from "./styles";

// ---------- formatting helpers ----------
// Dates are pinned to en-US so server-rendered PDFs read identically regardless
// of the Node host's default locale (Docker images vs laptops). The date option
// shapes + signedCents are shared with the web view via ~/lib/invoice/format.
const formatDate = (d: Date): string => formatInvoiceDate(d, "en-US");
const formatDateTime = (d: Date): string => formatInvoiceDateTime(d, "en-US");

function formatAddressLine(from: RenderableInvoice["from"]): string | null {
	const cityState = [from.city, from.state].filter((p) => p).join(", ");
	const second = [cityState, from.zipCode].filter((p) => p).join(" ");
	return second.length > 0 ? second : null;
}

// ---------- Sub-components ----------

function Header({ dto }: { dto: RenderableInvoice }) {
	const addressLine = formatAddressLine(dto.from);
	return (
		<View style={styles.headerRow}>
			<View style={styles.fromBlock}>
				<Text style={styles.clubName}>{dto.from.clubName}</Text>
				{dto.from.facilityName != null && (
					<Text style={styles.facilityLine}>{dto.from.facilityName}</Text>
				)}
				{dto.from.streetAddress != null && (
					<Text style={styles.facilityLine}>{dto.from.streetAddress}</Text>
				)}
				{addressLine != null && (
					<Text style={styles.facilityLine}>{addressLine}</Text>
				)}
				{dto.from.phone != null && (
					<Text style={styles.facilityLine}>{dto.from.phone}</Text>
				)}
				{dto.from.email != null && (
					<Text style={styles.facilityLine}>{dto.from.email}</Text>
				)}
			</View>
			<View style={styles.headerRight}>
				<Text style={styles.invoiceTitle}>{dto.meta.invoiceNumber}</Text>
				<Text
					style={[
						styles.statusPill,
						{ color: statusPillColor(dto.meta.statusTone) },
					]}
				>
					{dto.meta.statusLabel || "—"}
				</Text>
				<Text style={styles.invoiceMetaLine}>
					Issued {formatDate(dto.meta.issueDate)}
				</Text>
				{dto.meta.dueDate != null && (
					<Text style={styles.invoiceMetaLine}>
						Due {formatDate(dto.meta.dueDate)}
					</Text>
				)}
			</View>
		</View>
	);
}

function PartyDetails({
	party,
}: {
	party: RenderableInvoice["consumer"];
}) {
	return (
		<>
			<Text style={styles.partyName}>{party.fullName}</Text>
			{party.email != null && (
				<Text style={styles.partyDetail}>{party.email}</Text>
			)}
			{party.phone != null && (
				<Text style={styles.partyDetail}>{party.phone}</Text>
			)}
			{party.address != null && (
				<Text style={styles.partyDetail}>{party.address}</Text>
			)}
		</>
	);
}

function PartiesRow({ dto }: { dto: RenderableInvoice }) {
	// When bill-to differs from consumer we render two cards side by side
	// ("Bill to" and "For"). When they're the same we render a single
	// "Member" card occupying the full width via flex:1.
	if (dto.billedTo != null) {
		return (
			<View style={styles.partiesRow}>
				<View style={styles.partyCard}>
					<Text style={styles.partyLabel}>Bill to</Text>
					<PartyDetails party={dto.billedTo} />
				</View>
				<View style={styles.partyCard}>
					<Text style={styles.partyLabel}>For</Text>
					<PartyDetails party={dto.consumer} />
				</View>
			</View>
		);
	}
	return (
		<View style={styles.partiesRow}>
			<View style={styles.partyCard}>
				<Text style={styles.partyLabel}>Member</Text>
				<PartyDetails party={dto.consumer} />
			</View>
		</View>
	);
}

function LineItemsTable({ dto }: { dto: RenderableInvoice }) {
	const showTax = dto.totals.hasAnyTax;
	const descStyle = showTax
		? styles.colDescriptionWithTax
		: styles.colDescription;

	return (
		<View style={styles.table}>
			{/* `fixed` repeats the column header on every page the table spans,
			    so a multi-page invoice's continuation pages keep their
			    Description/Qty/Unit/Amount labels. */}
			<View style={styles.tableHeader} fixed>
				<Text style={descStyle}>Description</Text>
				<Text style={styles.colQty}>Qty</Text>
				<Text style={styles.colUnit}>Unit</Text>
				{showTax && <Text style={styles.colTax}>Tax</Text>}
				<Text style={styles.colAmount}>Amount</Text>
			</View>
			{dto.lines.length === 0 ? (
				<View style={styles.tableRow}>
					<Text
						style={{ color: COLORS.mutedInk, textAlign: "center", flex: 1 }}
					>
						No line items on this invoice.
					</Text>
				</View>
			) : (
				dto.lines.map((line, idx) => {
					const isLast = idx === dto.lines.length - 1;
					return (
						// `wrap={false}` is intentionally OMITTED here: a description
						// with a 200-char URL/SKU would otherwise be clipped at the page
						// edge. Letting react-pdf paginate the row lets break-all kick
						// in and the row spills onto the next page cleanly.
						<View
							key={line.lineItemId}
							style={[styles.tableRow, isLast ? styles.tableRowLast : {}]}
						>
							<View style={[descStyle, styles.descCell]}>
								<View style={styles.descMain}>
									<Text style={styles.descText}>{line.description}</Text>
									<Text style={styles.descKindPill}>{line.kindLabel}</Text>
								</View>
								{line.creditSource != null && (
									<Text style={styles.descSubtle}>
										Credit from {line.creditSource.payerName}
										{line.creditSource.invoiceNumber != null
											? ` · ${line.creditSource.invoiceNumber}`
											: ""}
									</Text>
								)}
								{line.revenueCategoryLabel != null && (
									<Text style={[styles.descSubtle, { fontStyle: "italic" }]}>
										{line.revenueCategoryLabel}
									</Text>
								)}
							</View>
							<Text style={styles.colQty}>{line.quantity}</Text>
							<Text style={[styles.colUnit, styles.mono]}>
								{signedCents(line.unitPriceInCents)}
							</Text>
							{showTax && (
								<Text style={[styles.colTax, styles.mono]}>
									{line.taxAmountInCents > 0
										? formatCents(line.taxAmountInCents)
										: "—"}
								</Text>
							)}
							<Text style={[styles.colAmount, styles.mono]}>
								{signedCents(line.totalInCents)}
							</Text>
						</View>
					);
				})
			)}
		</View>
	);
}

function TotalsBlock({ dto }: { dto: RenderableInvoice }) {
	const t = dto.totals;
	const isCredit = t.balanceInCents < 0;
	return (
		<View style={styles.totalsBlock} wrap={false}>
			<View style={styles.totalsRow}>
				<Text style={styles.totalsLabelMuted}>Subtotal</Text>
				<Text style={styles.mono}>{signedCents(t.subtotalInCents)}</Text>
			</View>
			{t.taxTotalInCents > 0 && (
				<View style={styles.totalsRow}>
					<Text style={styles.totalsLabelMuted}>Tax</Text>
					<Text style={styles.mono}>{formatCents(t.taxTotalInCents)}</Text>
				</View>
			)}
			<View style={[styles.totalsRow, styles.totalsRowBold]}>
				<Text>Total</Text>
				<Text style={styles.mono}>{signedCents(t.totalInCents)}</Text>
			</View>
			<View style={styles.totalsRow}>
				<Text style={styles.totalsLabelMuted}>Paid</Text>
				<Text style={[styles.mono, styles.totalsLabelMuted]}>
					{formatCents(t.amountPaidInCents)}
				</Text>
			</View>
			<View
				style={[styles.totalsRow, { fontFamily: "Noto Sans", fontWeight: 700 }]}
			>
				<Text style={isCredit ? { color: COLORS.successInk } : {}}>
					{isCredit ? "Credit" : "Balance"}
				</Text>
				<Text
					style={[styles.mono, isCredit ? { color: COLORS.successInk } : {}]}
				>
					{formatCents(Math.abs(t.balanceInCents))}
				</Text>
			</View>
		</View>
	);
}

function PaymentsBlock({ dto }: { dto: RenderableInvoice }) {
	if (dto.payments.length === 0) return null;
	return (
		<View>
			<Text style={styles.sectionTitle}>Payments</Text>
			<View>
				{dto.payments.map((p, idx) => {
					const isLast = idx === dto.payments.length - 1;
					return (
						<View
							key={p.paymentId}
							style={[styles.paymentRow, isLast ? styles.paymentRowLast : {}]}
							wrap={false}
						>
							<View style={styles.paymentLeft}>
								<Text>
									{p.methodLabel}
									{p.processor != null && (
										<Text style={{ color: COLORS.mutedInk }}>
											{` · ${p.processor}`}
										</Text>
									)}
								</Text>
								<Text style={styles.partyDetail}>
									{formatDateTime(p.receivedAt)}
								</Text>
								{p.reference != null && (
									<Text style={styles.partyDetail}>Ref: {p.reference}</Text>
								)}
							</View>
							<View style={styles.paymentRight}>
								<Text style={styles.mono}>{formatCents(p.amountInCents)}</Text>
								{p.refundedTotalInCents > 0 && (
									<Text style={styles.partyDetail}>
										{`\u2212${formatCents(p.refundedTotalInCents)} refunded · net ${formatCents(p.netInCents)}`}
									</Text>
								)}
							</View>
						</View>
					);
				})}
			</View>
		</View>
	);
}

function NotesBlock({ dto }: { dto: RenderableInvoice }) {
	// Whitespace-only notes ("   \n  ") would render an empty bordered box;
	// trim before deciding whether to draw the section at all.
	if (!dto.meta.notes?.trim()) return null;
	return (
		<View style={styles.notesBlock} wrap={false}>
			<Text style={[styles.sectionTitle, { marginTop: 0 }]}>Notes</Text>
			<Text style={styles.notesText}>{dto.meta.notes}</Text>
		</View>
	);
}

function PageFooter({ dto }: { dto: RenderableInvoice }) {
	const generatedAt = new Date().toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	return (
		<View style={styles.footer} fixed>
			{/* Filled divider instead of borderTop — see styles.footer note
			    (a border on this fixed element leaks a stroke through the
			    invoice number in the header). */}
			<View style={styles.footerDivider} />
			<View style={styles.footerRow}>
				<Text style={styles.footerText}>
					{dto.meta.invoiceNumber} · {dto.from.clubName}
				</Text>
				<Text
					render={({ pageNumber, totalPages }) =>
						`Page ${pageNumber} of ${totalPages} · Generated ${generatedAt}`
					}
				/>
			</View>
		</View>
	);
}

function VoidWatermark() {
	return (
		<View style={styles.voidWatermarkContainer} fixed>
			<Text style={styles.voidWatermarkText}>VOID</Text>
		</View>
	);
}

// ---------- Top-level document ----------

export function InvoicePdfDocument({ dto }: { dto: RenderableInvoice }) {
	const isVoid = dto.meta.rawStatus === "void";
	return (
		<Document
			title={`Invoice ${dto.meta.invoiceNumber}`}
			author={dto.from.clubName}
			subject={`Invoice for ${dto.consumer.fullName}`}
			creator="shuttlementor"
		>
			<Page size="LETTER" style={styles.page}>
				{isVoid && <VoidWatermark />}
				<Header dto={dto} />
				<PartiesRow dto={dto} />
				<LineItemsTable dto={dto} />
				<TotalsBlock dto={dto} />
				<PaymentsBlock dto={dto} />
				<NotesBlock dto={dto} />
				<PageFooter dto={dto} />
			</Page>
		</Document>
	);
}
