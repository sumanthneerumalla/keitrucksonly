// seed-categories.cjs
// Seeds default ProductCategory hierarchy for all existing clubs.
// Idempotent — safe to run multiple times (uses findFirst + create pattern).
//
// Category tree per club:
//   Credits (sortOrder: 0)
//     Calendar Events (sortOrder: 0)
//     Class Credits   (sortOrder: 1)
//     Coaching Slots  (sortOrder: 2)
//
// Run: docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app node prisma/scripts/seed-categories.cjs

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const SUBCATEGORIES = [
	{ name: "Calendar Events", sortOrder: 0 },
	{ name: "Class Credits", sortOrder: 1 },
	{ name: "Coaching Slots", sortOrder: 2 },
];

async function ensureCategory(
	clubShortName,
	name,
	parentCategoryId,
	sortOrder,
) {
	const existing = await prisma.productCategory.findFirst({
		where: {
			clubShortName,
			name,
			parentCategoryId: parentCategoryId ?? null,
		},
	});

	if (existing) {
		return existing;
	}

	return prisma.productCategory.create({
		data: {
			clubShortName,
			name,
			parentCategoryId: parentCategoryId ?? null,
			sortOrder,
		},
	});
}

async function main() {
	console.log("Seeding default product categories...\n");

	const clubs = await prisma.club.findMany({
		select: { clubShortName: true, clubName: true },
	});

	if (clubs.length === 0) {
		console.log("No clubs found — nothing to seed.");
		return;
	}

	for (const club of clubs) {
		console.log(`Club: ${club.clubName} (${club.clubShortName})`);

		// Top-level: Credits
		const credits = await ensureCategory(
			club.clubShortName,
			"Credits",
			null,
			0,
		);
		console.log(`  Credits (${credits.categoryId})`);

		// Subcategories under Credits
		for (const sub of SUBCATEGORIES) {
			const cat = await ensureCategory(
				club.clubShortName,
				sub.name,
				credits.categoryId,
				sub.sortOrder,
			);
			console.log(`    ${sub.name} (${cat.categoryId})`);
		}
	}

	console.log("\nDone! Default product categories seeded for all clubs.");
}

main()
	.catch((e) => {
		console.error("Seed error:", e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
