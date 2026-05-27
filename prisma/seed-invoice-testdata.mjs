/**
 * Phase 9a — invoice test-data seed for the local dev DB ONLY.
 *
 * Attaches a spread of invoices to two specific named test members of the
 * `dc-badminton` club — Uma (the consumer who carries the invoices) and Uri
 * (the bill-to payer on one invoice). They are in different family groups (Uri
 * has none), so the "Bill to" case still demonstrates billing an unrelated club
 * member rather than a family co-pay.
 * The invoices exercise every state the invoicing UI renders: open tab,
 * partially paid, marked due, paid, paid-then-refunded, account credit
 * (overpaid), bill-to (one member billed for another's charges), credit
 * carry-forward, and void.
 *
 * Idempotent: all test invoices use the `INV-T….` number prefix and are wiped
 * + rebuilt on every run, so it never collides with or mutates real data.
 * Also removes the earlier synthetic "Tess/Parker" seed users if present.
 *
 * Run inside the dev app container:
 *   docker exec shuttlementor-app-dev node /app/prisma/seed-invoice-testdata.mjs
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CLUB = "dc-badminton";
const dayMs = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * dayMs);

async function main() {
	const club = await db.club.findUnique({ where: { clubShortName: CLUB } });
	if (!club) throw new Error(`Club ${CLUB} not found`);

	// Real staff for the createdBy / receivedBy / closedBy / refundedBy FKs.
	const admin = await db.user.findFirst({
		where: {
			clubShortName: CLUB,
			userType: { in: ["CLUB_ADMIN", "PLATFORM_ADMIN"] },
		},
		select: { userId: true },
	});
	const facility = await db.user.findFirst({
		where: { clubShortName: CLUB, userType: "FACILITY" },
		select: { userId: true },
	});
	const staffCreatedBy = admin?.userId;
	const staffReceivedBy = facility?.userId ?? admin?.userId;
	if (!staffCreatedBy || !staffReceivedBy) {
		throw new Error(
			"No staff (CLUB_ADMIN/FACILITY) found in club to own the rows",
		);
	}

	// --- Idempotent cleanup ---------------------------------------------------
	// 1) Remove prior INV-T… test invoices + children (line items first so the
	//    creditFromInvoiceId references don't block the invoice delete).
	const prior = await db.invoice.findMany({
		where: { clubShortName: CLUB, invoiceNumber: { startsWith: "INV-T" } },
		select: { invoiceId: true },
	});
	const priorIds = prior.map((i) => i.invoiceId);
	if (priorIds.length) {
		await db.invoiceRefund.deleteMany({
			where: { invoiceId: { in: priorIds } },
		});
		await db.invoicePayment.deleteMany({
			where: { invoiceId: { in: priorIds } },
		});
		await db.invoiceLineItem.deleteMany({
			where: { invoiceId: { in: priorIds } },
		});
		await db.invoice.deleteMany({ where: { invoiceId: { in: priorIds } } });
	}
	// 2) Drop the earlier synthetic "Tess/Parker" users from the first pass
	//    (now that their invoices are gone, nothing references them).
	await db.user.deleteMany({
		where: {
			clerkUserId: { in: ["test_kid_dcbad_seed", "test_parent_dcbad_seed"] },
		},
	});

	// --- Pin to two specific named test members: Uma + Uri --------------------
	// Uma is the consumer (carries the full spread of invoices); Uri is the
	// bill-to counterpart on INV-T0007. Looked up by first name so the demo data
	// always lands on the same humans staff can search for by name.
	const findStudent = (firstName) =>
		db.user.findFirst({
			where: {
				clubShortName: CLUB,
				userType: "STUDENT",
				firstName: { equals: firstName, mode: "insensitive" },
			},
			orderBy: { userId: "asc" },
			select: { userId: true, firstName: true, lastName: true },
		});
	const consumer = await findStudent("Uma");
	const payer = await findStudent("Uri");
	if (!consumer || !payer) {
		throw new Error(
			"Need STUDENT members named Uma and Uri in dc-badminton (run the main user seed first)",
		);
	}
	const consumerName = `${consumer.firstName} ${consumer.lastName}`;
	const payerName = `${payer.firstName} ${payer.lastName}`;

	// A revenue category so the staff detail view has a classification to show.
	const lessons = await db.revenueCategory.upsert({
		where: { clubShortName_code: { clubShortName: CLUB, code: "LESSONS" } },
		update: { label: "Lessons" },
		create: { clubShortName: CLUB, code: "LESSONS", label: "Lessons" },
		select: { revenueCategoryId: true },
	});
	const revCat = lessons.revenueCategoryId;

	// Helper: create an invoice with line items (+ optional single nested payment).
	async function mk({
		number,
		consumerId,
		payerId = null,
		status,
		issueDate,
		dueDate = null,
		closedAt = null,
		closedBy = null,
		creditConsumedAt = null,
		amountPaidInCents = 0,
		notes = null,
		lines,
		payment = null,
	}) {
		const subtotal = lines.reduce(
			(s, l) => s + l.unitPriceInCents * (l.quantity ?? 1),
			0,
		);
		return db.invoice.create({
			data: {
				clubShortName: CLUB,
				invoiceNumber: number,
				userId: consumerId,
				billedToUserId: payerId,
				status,
				issueDate,
				dueDate,
				subtotalInCents: subtotal,
				taxTotalInCents: 0,
				totalInCents: subtotal,
				amountPaidInCents,
				notes,
				createdBy: staffCreatedBy,
				closedAt,
				closedBy,
				creditConsumedAt,
				lineItems: {
					create: lines.map((l, i) => ({
						kind: l.kind,
						description: l.description,
						quantity: l.quantity ?? 1,
						unitPriceInCents: l.unitPriceInCents,
						totalInCents: l.unitPriceInCents * (l.quantity ?? 1),
						sortOrder: i,
						revenueCategoryId: l.revenueCategoryId ?? null,
						creditFromUserId: l.creditFromUserId ?? null,
						creditFromInvoiceId: l.creditFromInvoiceId ?? null,
					})),
				},
				...(payment
					? {
							payments: {
								create: [{ ...payment, receivedBy: staffReceivedBy }],
							},
						}
					: {}),
			},
			select: { invoiceId: true, invoiceNumber: true },
		});
	}

	// 1) Open tab, nothing paid.
	await mk({
		number: "INV-T0001",
		consumerId: consumer.userId,
		status: "open",
		issueDate: daysAgo(1),
		lines: [
			{
				kind: "PACKAGE_SALE",
				description: "10-Class Junior Pass",
				unitPriceInCents: 12000,
				revenueCategoryId: revCat,
			},
			{
				kind: "PRODUCT_SALE",
				description: "Grip tape",
				quantity: 2,
				unitPriceInCents: 500,
			},
		],
	});

	// 2) Partially paid open tab ($100 of $250).
	await mk({
		number: "INV-T0002",
		consumerId: consumer.userId,
		status: "partially_paid",
		issueDate: daysAgo(6),
		amountPaidInCents: 10000,
		lines: [
			{
				kind: "PACKAGE_SALE",
				description: "Private Lesson (5-pack)",
				unitPriceInCents: 25000,
				revenueCategoryId: revCat,
			},
		],
		payment: {
			amountInCents: 10000,
			paymentMethod: "cash",
			receivedAt: daysAgo(5),
		},
	});

	// 3) Marked due, still owes (closedAt + dueDate set), with a note.
	await mk({
		number: "INV-T0003",
		consumerId: consumer.userId,
		status: "open",
		issueDate: daysAgo(12),
		dueDate: daysAgo(3),
		closedAt: daysAgo(3),
		closedBy: staffCreatedBy,
		notes:
			"Marked due — please settle the outstanding balance at the front desk.",
		lines: [
			{
				kind: "RENTAL",
				description: "Court rental — May block",
				unitPriceInCents: 8000,
			},
		],
	});

	// 4) Fully paid (auto-closed) via card.
	await mk({
		number: "INV-T0004",
		consumerId: consumer.userId,
		status: "paid",
		issueDate: daysAgo(20),
		closedAt: daysAgo(19),
		closedBy: staffCreatedBy,
		amountPaidInCents: 2500,
		lines: [
			{
				kind: "EVENT_REGISTRATION",
				description: "Saturday Drop-in",
				unitPriceInCents: 2500,
			},
		],
		payment: {
			amountInCents: 2500,
			paymentMethod: "credit_card",
			processor: "stripe",
			processorTransactionId: "pi_test_T0004",
			receivedAt: daysAgo(19),
		},
	});

	// 5) Paid then partially refunded -> partially_paid, balance owed.
	const inv5 = await mk({
		number: "INV-T0005",
		consumerId: consumer.userId,
		status: "partially_paid",
		issueDate: daysAgo(9),
		amountPaidInCents: 4500, // 6000 paid - 1500 refunded
		lines: [
			{
				kind: "EVENT_REGISTRATION",
				description: "Spring Tournament Entry",
				unitPriceInCents: 6000,
			},
		],
		payment: {
			amountInCents: 6000,
			paymentMethod: "credit_card",
			processor: "stripe",
			processorTransactionId: "pi_test_T0005",
			receivedAt: daysAgo(8),
		},
	});
	const pay5 = await db.invoicePayment.findFirst({
		where: { invoiceId: inv5.invoiceId },
		select: { paymentId: true },
	});
	await db.invoiceRefund.create({
		data: {
			paymentId: pay5.paymentId,
			invoiceId: inv5.invoiceId,
			amountInCents: 1500,
			reason: "Withdrew from tournament — partial refund",
			refundedBy: staffCreatedBy,
			processor: "stripe",
			processorRefundId: "re_test_T0005",
			refundedAt: daysAgo(7),
		},
	});

	// 6) Overpaid -> account credit (negative balance); credit later consumed by #8.
	const inv6 = await mk({
		number: "INV-T0006",
		consumerId: consumer.userId,
		status: "paid",
		issueDate: daysAgo(25),
		closedAt: daysAgo(24),
		closedBy: staffCreatedBy,
		creditConsumedAt: daysAgo(2),
		amountPaidInCents: 12000, // overpaid by $24 on a $96 invoice
		lines: [
			{
				kind: "PACKAGE_SALE",
				description: "8-Class Pass",
				unitPriceInCents: 9600,
				revenueCategoryId: revCat,
			},
		],
		payment: {
			amountInCents: 12000,
			paymentMethod: "cash",
			receivedAt: daysAgo(24),
		},
	});

	// 7) BILL-TO: the consumer's charges are billed to an arbitrary OTHER member.
	await mk({
		number: "INV-T0007",
		consumerId: consumer.userId,
		payerId: payer.userId,
		status: "open",
		issueDate: daysAgo(2),
		notes: `Charges billed to ${payerName} (a different club member, not family).`,
		lines: [
			{
				kind: "PACKAGE_SALE",
				description: "Summer Camp — Week 1",
				unitPriceInCents: 20000,
				revenueCategoryId: revCat,
			},
		],
	});

	// 8) Credit carry-forward: a negative CREDIT line pulled from #6.
	await mk({
		number: "INV-T0008",
		consumerId: consumer.userId,
		status: "open",
		issueDate: daysAgo(2),
		lines: [
			{
				kind: "PACKAGE_SALE",
				description: "12-Class Pass",
				unitPriceInCents: 14400,
				revenueCategoryId: revCat,
			},
			{
				kind: "CREDIT",
				description: "Credit from INV-T0006",
				unitPriceInCents: -2400,
				creditFromUserId: consumer.userId,
				creditFromInvoiceId: inv6.invoiceId,
			},
		],
	});

	// 9) Void (staff sees "Voided"; hidden from members).
	await mk({
		number: "INV-T0009",
		consumerId: consumer.userId,
		status: "void",
		issueDate: daysAgo(30),
		lines: [
			{
				kind: "FEE",
				description: "Erroneous charge (voided)",
				unitPriceInCents: 5000,
			},
		],
	});

	console.log("SEED_OK");
	console.log(
		`CONSUMER (main demo member): ${consumerName}  ${consumer.userId}`,
	);
	console.log(`PAYER (bill-to counterpart):  ${payerName}  ${payer.userId}`);
}

main()
	.then(() => db.$disconnect())
	.catch(async (e) => {
		console.error("SEED_ERROR:", e);
		await db.$disconnect();
		process.exit(1);
	});
