/**
 * Seeds NVBC's full public catalog (memberships + packages) into a chosen club.
 *
 * Source: https://novabadmintonacademy.com/membership-and-fees/ (verified 2026-05-28).
 *
 * Seeds:
 *  - 4 MembershipTypes + MembershipPlans: Adult Monthly, Senior Monthly,
 *    Junior Monthly, Annual.
 *  - 4 PackagePlans (general drop-in): Shared 10 / 20 / 50 Pass + Individual
 *    Day Pass.
 *
 * NOT seeded (no clean model today):
 *  - Group Day Passes (groups of 2–5) — no per-attendee semantics on a single
 *    sale. Track in roadmap if/when a group voucher primitive lands.
 *  - Court Booking rates ($40 / $115 per hour, group of 4) — these are rental
 *    rates, not a plan; live on ClubResource / RentalBooking pricing.
 *
 * Idempotent — re-runnable. Membership upserts by (clubShortName, name);
 * plans by (membershipTypeId, description); packages by (clubShortName, name).
 *
 * Defaults to `nova-test`; pass a different clubShortName as the first arg:
 *   docker exec -i shuttlementor-app-dev npx tsx prisma/seeds/nvbc.ts
 *   docker exec -i shuttlementor-app-dev npx tsx prisma/seeds/nvbc.ts dc-badminton
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CLUB = process.argv[2] ?? "nova-test";

// ---------- Memberships ----------

type TierSeed = {
	typeName: string;
	sortOrder: number;
	plan: {
		description: string;
		billingFrequency: "monthly" | "quarterly" | "annually" | "custom";
		billingInterval: number;
		billingUnit: "day" | "week" | "month" | "year";
		feePerTermInCents: number;
	};
};

const TIERS: TierSeed[] = [
	{
		typeName: "Adult Monthly",
		sortOrder: 10,
		plan: {
			description: "$75/month, unlimited court access (non-refundable)",
			billingFrequency: "monthly",
			billingInterval: 1,
			billingUnit: "month",
			feePerTermInCents: 7500,
		},
	},
	{
		typeName: "Senior Monthly",
		sortOrder: 20,
		plan: {
			description: "$29/month, unlimited court access (non-refundable)",
			billingFrequency: "monthly",
			billingInterval: 1,
			billingUnit: "month",
			feePerTermInCents: 2900,
		},
	},
	{
		typeName: "Junior Monthly",
		sortOrder: 30,
		plan: {
			description: "$42/month, unlimited court access (non-refundable)",
			billingFrequency: "monthly",
			billingInterval: 1,
			billingUnit: "month",
			feePerTermInCents: 4200,
		},
	},
	{
		typeName: "Annual",
		sortOrder: 40,
		plan: {
			description: "$810/year, unlimited court access (non-refundable)",
			billingFrequency: "annually",
			billingInterval: 1,
			billingUnit: "year",
			feePerTermInCents: 81000,
		},
	},
];

// ---------- Packages ----------

type PackageSeed = {
	name: string;
	description: string;
	sessionCount: number;
	priceInCents: number;
	durationValue: number | null;
	durationUnit: "days" | "weeks" | "months" | "years" | null;
	sortOrder: number;
};

const PACKAGES: PackageSeed[] = [
	{
		name: "Individual Day Pass",
		description: "$25 single-visit drop-in pass",
		sessionCount: 1,
		priceInCents: 2500,
		durationValue: null,
		durationUnit: null,
		sortOrder: 10,
	},
	{
		name: "Shared 10 Pass",
		description: "10 drop-in credits, expires in 90 days",
		sessionCount: 10,
		priceInCents: 20000,
		durationValue: 90,
		durationUnit: "days",
		sortOrder: 20,
	},
	{
		name: "Shared 20 Pass",
		description: "20 drop-in credits, expires in 180 days",
		sessionCount: 20,
		priceInCents: 36000,
		durationValue: 180,
		durationUnit: "days",
		sortOrder: 30,
	},
	{
		name: "Shared 50 Pass",
		description: "50 drop-in credits, expires in 1 year",
		sessionCount: 50,
		priceInCents: 80000,
		durationValue: 1,
		durationUnit: "years",
		sortOrder: 40,
	},
];

// ---------- Runner ----------

async function ensureClub() {
	// Auto-bootstrap only when seeding into the dedicated `nova-test` slug
	// (which may not exist on a fresh env). For any other clubShortName, require
	// the club to already exist — don't invent rows.
	if (CLUB === "nova-test") {
		await db.club.upsert({
			where: { clubShortName: CLUB },
			update: {},
			create: {
				clubShortName: CLUB,
				clubName: "Nova Badminton Academy (test)",
			},
		});
	} else {
		const club = await db.club.findUnique({
			where: { clubShortName: CLUB },
			select: { clubShortName: true },
		});
		if (!club) throw new Error(`Club ${CLUB} not found`);
	}
}

async function seedMemberships() {
	let typesCreated = 0;
	let typesUpdated = 0;
	let plansCreated = 0;
	let plansUpdated = 0;

	for (const tier of TIERS) {
		const existingType = await db.membershipType.findUnique({
			where: {
				clubShortName_name: { clubShortName: CLUB, name: tier.typeName },
			},
			select: { membershipTypeId: true },
		});

		const type = await db.membershipType.upsert({
			where: {
				clubShortName_name: { clubShortName: CLUB, name: tier.typeName },
			},
			update: { sortOrder: tier.sortOrder, isActive: true },
			create: {
				clubShortName: CLUB,
				name: tier.typeName,
				sortOrder: tier.sortOrder,
				isActive: true,
			},
		});
		if (existingType) typesUpdated++;
		else typesCreated++;

		const existingPlan = await db.membershipPlan.findFirst({
			where: {
				membershipTypeId: type.membershipTypeId,
				description: tier.plan.description,
			},
			select: { membershipPlanId: true },
		});

		const planData = {
			clubShortName: CLUB,
			membershipTypeId: type.membershipTypeId,
			description: tier.plan.description,
			billingFrequency: tier.plan.billingFrequency,
			billingInterval: tier.plan.billingInterval,
			billingUnit: tier.plan.billingUnit,
			billingCycles: null,
			feePerTermInCents: tier.plan.feePerTermInCents,
			initiationFeeInCents: 0,
			maxVisits: null,
			autoRenew: false,
			sellOnline: false,
			isActive: true,
		};

		if (existingPlan) {
			await db.membershipPlan.update({
				where: { membershipPlanId: existingPlan.membershipPlanId },
				data: planData,
			});
			plansUpdated++;
		} else {
			await db.membershipPlan.create({ data: planData });
			plansCreated++;
		}
	}

	return { typesCreated, typesUpdated, plansCreated, plansUpdated };
}

async function seedPackages() {
	let pkgsCreated = 0;
	let pkgsUpdated = 0;

	for (const pkg of PACKAGES) {
		// PackagePlan has no @@unique constraint; key on (clubShortName, name).
		const existing = await db.packagePlan.findFirst({
			where: { clubShortName: CLUB, name: pkg.name },
			select: { packagePlanId: true },
		});

		const data = {
			clubShortName: CLUB,
			productId: null,
			isGeneralDropIn: true,
			name: pkg.name,
			description: pkg.description,
			sessionCount: pkg.sessionCount,
			priceInCents: pkg.priceInCents,
			durationValue: pkg.durationValue,
			durationUnit: pkg.durationUnit,
			autoRenew: false,
			isActive: true,
			isPubliclyListed: false,
			sortOrder: pkg.sortOrder,
		};

		if (existing) {
			await db.packagePlan.update({
				where: { packagePlanId: existing.packagePlanId },
				data,
			});
			pkgsUpdated++;
		} else {
			await db.packagePlan.create({ data });
			pkgsCreated++;
		}
	}

	return { pkgsCreated, pkgsUpdated };
}

async function main() {
	await ensureClub();
	const m = await seedMemberships();
	const p = await seedPackages();

	console.log(`NVBC catalog seeded into "${CLUB}":`);
	console.log(
		`  MembershipTypes: ${m.typesCreated} created, ${m.typesUpdated} updated`,
	);
	console.log(
		`  MembershipPlans: ${m.plansCreated} created, ${m.plansUpdated} updated`,
	);
	console.log(
		`  PackagePlans:    ${p.pkgsCreated} created, ${p.pkgsUpdated} updated`,
	);
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
