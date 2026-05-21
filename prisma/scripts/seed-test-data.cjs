// seed-test-data.js
// Creates 2 clubs with 2 facilities each, and 22 users with various roles.
// Seed users have fake clerkUserId values (seed_<email>) — they will NOT be
// able to log in via Clerk. They exist purely for testing the admin users table,
// filters, pagination, role changes, and multi-club scenarios.
//
// Run: docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app node prisma/scripts/seed-test-data.js

const { PrismaClient, UserType } = require("@prisma/client");
const prisma = new PrismaClient();

const CLUBS = [
	{ clubShortName: "dc-badminton", clubName: "DC Badminton Club" },
	{ clubShortName: "testshortname", clubName: "Club-Test" },
];

const FACILITIES = [
	{ clubShortName: "dc-badminton", name: "Georgetown Courts", city: "Washington", state: "DC" },
	{ clubShortName: "dc-badminton", name: "Capitol Hill Gym", city: "Washington", state: "DC" },
	{ clubShortName: "testshortname", name: "Fairfax Center", city: "Fairfax", state: "VA" },
];

// 22 users — mix of roles across both clubs
const USERS = [
	// DC Badminton — club admin manages both facilities
	{ first: "Alice", last: "Chen", email: "alice@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "CLUB_ADMIN" }, { facility: 1, role: "CLUB_ADMIN" }] },
	{ first: "Bob", last: "Martinez", email: "bob@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "FACILITY" }, { facility: 1, role: "FACILITY" }] },
	{ first: "Carol", last: "Williams", email: "carol@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "COACH" }] },
	{ first: "David", last: "Kim", email: "david@test.com", club: "dc-badminton", roles: [{ facility: 1, role: "COACH" }] },
	{ first: "Elena", last: "Patel", email: "elena@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "STUDENT" }] },
	{ first: "Frank", last: "Johnson", email: "frank@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "STUDENT" }, { facility: 1, role: "STUDENT" }] },
	{ first: "Grace", last: "Liu", email: "grace@test.com", club: "dc-badminton", roles: [{ facility: 1, role: "STUDENT" }] },
	{ first: "Henry", last: "Brown", email: "henry@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "STUDENT" }] },
	{ first: "Iris", last: "Nguyen", email: "iris@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "STUDENT" }] },
	{ first: "Jack", last: "Taylor", email: "jack@test.com", club: "dc-badminton", roles: [{ facility: 1, role: "STUDENT" }] },

	// Nova Shuttle — club admin manages both facilities
	{ first: "Karen", last: "Lee", email: "karen@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "CLUB_ADMIN" }, { facility: 3, role: "CLUB_ADMIN" }] },
	{ first: "Leo", last: "Garcia", email: "leo@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "FACILITY" }] },
	{ first: "Maya", last: "Robinson", email: "maya@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "COACH" }, { facility: 3, role: "COACH" }] },
	{ first: "Noah", last: "Clark", email: "noah@test.com", club: "nova-shuttle", roles: [{ facility: 3, role: "COACH" }] },
	{ first: "Olivia", last: "Wright", email: "olivia@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "STUDENT" }] },
	{ first: "Peter", last: "Hall", email: "peter@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "STUDENT" }, { facility: 3, role: "STUDENT" }] },
	{ first: "Quinn", last: "Adams", email: "quinn@test.com", club: "nova-shuttle", roles: [{ facility: 3, role: "STUDENT" }] },
	{ first: "Rachel", last: "Scott", email: "rachel@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "STUDENT" }] },
	{ first: "Sam", last: "Turner", email: "sam@test.com", club: "nova-shuttle", roles: [{ facility: 3, role: "STUDENT" }] },
	{ first: "Tina", last: "Evans", email: "tina@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "STUDENT" }] },

	// Cross-club user: STUDENT at DC, COACH at Nova — tests multi-club membership
	{ first: "Uma", last: "Cross", email: "uma@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "STUDENT" }, { facility: 2, role: "COACH" }] },

	// Platform admin
	{ first: "Zeus", last: "Admin", email: "zeus@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "PLATFORM_ADMIN" }] },

	// Extra coaches for pagination testing
	{ first: "Liam", last: "Park", email: "liam@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "COACH" }] },
	{ first: "Mia", last: "Santos", email: "mia@test.com", club: "dc-badminton", roles: [{ facility: 1, role: "COACH" }] },
	{ first: "Ethan", last: "Rao", email: "ethan@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "COACH" }] },
	{ first: "Sophia", last: "Chang", email: "sophia@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "COACH" }] },
	{ first: "Aiden", last: "Murphy", email: "aiden@test.com", club: "nova-shuttle", roles: [{ facility: 3, role: "COACH" }] },
	{ first: "Chloe", last: "Tanaka", email: "chloe@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "COACH" }] },
	{ first: "Lucas", last: "Singh", email: "lucas@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "COACH" }] },
	{ first: "Ava", last: "Morales", email: "ava@test.com", club: "dc-badminton", roles: [{ facility: 1, role: "COACH" }] },
	{ first: "Oliver", last: "Nakamura", email: "oliver@test.com", club: "nova-shuttle", roles: [{ facility: 3, role: "COACH" }] },
	{ first: "Emma", last: "Rivera", email: "emma@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "COACH" }] },
	{ first: "James", last: "Sharma", email: "james@test.com", club: "dc-badminton", roles: [{ facility: 0, role: "COACH" }] },
	{ first: "Lily", last: "O'Brien", email: "lily@test.com", club: "dc-badminton", roles: [{ facility: 1, role: "COACH" }] },
	{ first: "Ben", last: "Choi", email: "ben@test.com", club: "nova-shuttle", roles: [{ facility: 3, role: "COACH" }] },
	{ first: "Zoe", last: "Petrov", email: "zoe@test.com", club: "nova-shuttle", roles: [{ facility: 2, role: "COACH" }] },
];

async function main() {
	console.log("Seeding test data...\n");

	// 1. Create clubs
	for (const club of CLUBS) {
		await prisma.club.upsert({
			where: { clubShortName: club.clubShortName },
			create: club,
			update: { clubName: club.clubName },
		});
		console.log(`Club: ${club.clubName}`);
	}

	// 2. Create facilities
	const facilityRecords = [];
	for (const [i, f] of FACILITIES.entries()) {
		const record = await prisma.clubFacility.upsert({
			where: {
				clubShortName_name: { clubShortName: f.clubShortName, name: f.name },
			},
			create: {
				clubShortName: f.clubShortName,
				name: f.name,
				city: f.city,
				state: f.state,
				position: i % 2,
				isActive: true,
			},
			update: { city: f.city, state: f.state, isActive: true },
		});
		facilityRecords.push(record);
		console.log(`  Facility: ${f.name} (${f.clubShortName})`);
	}

	// 3. Create users + memberships
	console.log("");
	for (const u of USERS) {
		const firstRole = u.roles[0];
		const firstFacility = facilityRecords[firstRole.facility];

		const user = await prisma.user.upsert({
			where: { clerkUserId: `seed_${u.email}` },
			create: {
				clerkUserId: `seed_${u.email}`,
				firstName: u.first,
				lastName: u.last,
				email: u.email,
				userType: firstRole.role,
				clubShortName: u.club,
				activeFacilityId: firstFacility.facilityId,
			},
			update: {
				firstName: u.first,
				lastName: u.last,
				email: u.email,
				userType: firstRole.role,
				clubShortName: u.club,
				activeFacilityId: firstFacility.facilityId,
			},
		});

		// Create UserClub memberships — derive clubShortName from the facility, not the user,
		// so cross-club memberships get the correct club association.
		for (const r of u.roles) {
			const facility = facilityRecords[r.facility];
			await prisma.userClub.upsert({
				where: {
					userId_facilityId: { userId: user.userId, facilityId: facility.facilityId },
				},
				create: {
					userId: user.userId,
					clubShortName: FACILITIES[r.facility].clubShortName,
					facilityId: facility.facilityId,
					role: r.role,
				},
				update: { role: r.role },
			});
		}

		const rolesSummary = u.roles.map((r) => `${FACILITIES[r.facility].name}:${r.role}`).join(", ");
		console.log(`User: ${u.first} ${u.last} — ${rolesSummary}`);
	}

	// 4. Add the real platform admin to dc-badminton so they can see seed users
	const realAdmin = await prisma.user.findFirst({
		where: { email: "sumanth42gold@gmail.com" },
	});
	if (realAdmin) {
		for (const f of facilityRecords.filter((r) => r.clubShortName === "dc-badminton")) {
			await prisma.userClub.upsert({
				where: { userId_facilityId: { userId: realAdmin.userId, facilityId: f.facilityId } },
				create: { userId: realAdmin.userId, clubShortName: "dc-badminton", facilityId: f.facilityId, role: "PLATFORM_ADMIN" },
				update: {},
			});
		}
		console.log(`\nAdded ${realAdmin.firstName} ${realAdmin.lastName} to dc-badminton as PLATFORM_ADMIN`);
		console.log("Switch to dc-badminton club via the club switcher to see seed users.");
	}

	// 5. Create coach profiles for users with COACH/CLUB_ADMIN roles
	const COACH_PROFILES = [
		{ email: "carol@test.com", username: "coach_carol", bio: "Specializes in footwork and singles strategy", experience: "10 years competitive, 5 years coaching", specialties: ["Footwork", "Singles"], teachingStyles: ["Structured", "Analytical"], rate: 45 },
		{ email: "david@test.com", username: "coach_david", bio: "Former national doubles player turned coach", experience: "8 years coaching juniors and adults", specialties: ["Doubles", "Net Play"], teachingStyles: ["Energetic", "Game-Based"], rate: 55 },
		{ email: "maya@test.com", username: "coach_maya", bio: "All-round coach with focus on beginners", experience: "6 years coaching at club level", specialties: ["Fundamentals", "Fitness"], teachingStyles: ["Patient", "Encouraging"], rate: 35 },
		{ email: "noah@test.com", username: "coach_noah", bio: "Technical coach specializing in stroke correction", experience: "12 years coaching experience", specialties: ["Stroke Technique", "Smash"], teachingStyles: ["Detail-Oriented", "Video Analysis"], rate: 60 },
		{ email: "uma@test.com", username: "coach_uma", bio: "Cross-club coach available at multiple locations", experience: "4 years coaching mixed levels", specialties: ["Mixed Doubles", "Tactics"], teachingStyles: ["Flexible", "Adaptive"], rate: 40 },
		{ email: "alice@test.com", username: "admin_alice", bio: "Club administrator and occasional coach", experience: "15 years in badminton", specialties: ["Administration", "Club Management"], teachingStyles: ["Mentoring", "Strategic"], rate: 50 },
		{ email: "karen@test.com", username: "admin_karen", bio: "Nova Shuttle founder and head coach", experience: "20 years competitive and coaching", specialties: ["Program Development", "Advanced Tactics"], teachingStyles: ["Holistic", "Competition Prep"], rate: 70 },
		{ email: "liam@test.com", username: "coach_liam", bio: "Youth development specialist", experience: "7 years junior coaching", specialties: ["Junior Development", "Footwork"], teachingStyles: ["Fun", "Progressive"], rate: 40 },
		{ email: "mia@test.com", username: "coach_mia", bio: "Fitness-focused badminton training", experience: "5 years fitness coaching", specialties: ["Fitness", "Agility"], teachingStyles: ["High Intensity", "Circuit Training"], rate: 45 },
		{ email: "ethan@test.com", username: "coach_ethan", bio: "Strategic doubles coach", experience: "9 years doubles specialist", specialties: ["Doubles Strategy", "Rotation"], teachingStyles: ["Tactical", "Match Play"], rate: 55 },
		{ email: "sophia@test.com", username: "coach_sophia", bio: "Mental game and competition prep", experience: "6 years sports psychology", specialties: ["Mental Game", "Competition Prep"], teachingStyles: ["Mindfulness", "Visualization"], rate: 65 },
		{ email: "aiden@test.com", username: "coach_aiden", bio: "Power and smash technique expert", experience: "8 years power training", specialties: ["Smash", "Power Training"], teachingStyles: ["Explosive", "Biomechanics"], rate: 50 },
		{ email: "chloe@test.com", username: "coach_chloe", bio: "Beginner-friendly patient coach", experience: "4 years recreational coaching", specialties: ["Beginners", "Rally Building"], teachingStyles: ["Patient", "Step-by-Step"], rate: 30 },
		{ email: "lucas@test.com", username: "coach_lucas", bio: "Advanced singles tactics", experience: "11 years competitive singles", specialties: ["Singles Tactics", "Deception"], teachingStyles: ["Analytical", "Drill-Based"], rate: 60 },
		{ email: "ava@test.com", username: "coach_ava", bio: "Mixed doubles specialist", experience: "6 years mixed doubles", specialties: ["Mixed Doubles", "Communication"], teachingStyles: ["Partner-Focused", "Collaborative"], rate: 45 },
		{ email: "oliver@test.com", username: "coach_oliver", bio: "Defensive play and recovery", experience: "7 years coaching defense", specialties: ["Defense", "Recovery Shots"], teachingStyles: ["Resilience", "Consistency"], rate: 40 },
		{ email: "emma@test.com", username: "coach_emma", bio: "Serve and return game expert", experience: "5 years serve specialist", specialties: ["Serve", "Return Game"], teachingStyles: ["Repetition", "Precision"], rate: 35 },
		{ email: "james@test.com", username: "coach_james", bio: "Tournament preparation coach", experience: "10 years tournament coaching", specialties: ["Tournament Prep", "Match Analysis"], teachingStyles: ["Video Review", "Simulation"], rate: 70 },
		{ email: "lily@test.com", username: "coach_lily", bio: "Flexibility and injury prevention", experience: "8 years sports rehab", specialties: ["Flexibility", "Injury Prevention"], teachingStyles: ["Gentle", "Corrective"], rate: 50 },
		{ email: "ben@test.com", username: "coach_ben", bio: "High performance training programs", experience: "9 years elite coaching", specialties: ["High Performance", "Speed"], teachingStyles: ["Demanding", "Results-Oriented"], rate: 75 },
		{ email: "zoe@test.com", username: "coach_zoe", bio: "Creative and fun training sessions", experience: "3 years coaching kids and adults", specialties: ["Creative Drills", "Fun Games"], teachingStyles: ["Playful", "Motivating"], rate: 35 },
	];

	// Generate 34 additional coach users + profiles to reach ~55 total coaches
	const EXTRA_FIRST = ["Ryan","Nina","Max","Priya","Leo","Sara","Tom","Jade","Kai","Luna","Omar","Isla","Finn","Nora","Ravi","Mei","Hugo","Aria","Dex","Yuki","Axel","Tara","Jude","Vera","Rex","Lena","Cruz","Ivy","Dale","Nika","Beau","Faye","Nash","Wren"];
	const EXTRA_LAST = ["Lee","Pham","Roy","Das","Xu","Soto","Gill","Ito","Cole","Diaz","Fong","Hart","Kwan","Luo","Moss","Neal","Peng","Ruiz","Shah","Tran","Voss","Wade","Yang","Zhu","Cruz","Park","Bell","Hahn","Jain","Kern","Lam","Muir","Ong","Pike"];
	const SPECIALTIES = ["Footwork","Singles","Doubles","Net Play","Smash","Defense","Fitness","Tactics","Serve","Deception","Speed","Agility","Mental Game","Stroke Technique","Rally Building"];
	const STYLES = ["Patient","Energetic","Analytical","Game-Based","Structured","Fun","Drill-Based","Video Analysis","Motivating","Adaptive"];

	for (let i = 0; i < 34; i++) {
		const first = EXTRA_FIRST[i];
		const last = EXTRA_LAST[i];
		const email = `${first.toLowerCase()}${i}@test.com`;
		// Round-robin across every facility regardless of how many clubs the
		// script defines — adding a new demo club + facility automatically
		// gets filler coaches without further script edits. Deriving club
		// from facility also fixes a latent mismatch in the prior version
		// where User.clubShortName could disagree with UserClub.clubShortName
		// on odd iterations (alternation said nova-shuttle, facility was
		// dc-badminton).
		const facilityIdx = i % facilityRecords.length;
		const facility = facilityRecords[facilityIdx];
		const club = facility.clubShortName;

		const user = await prisma.user.upsert({
			where: { clerkUserId: `seed_${email}` },
			create: {
				clerkUserId: `seed_${email}`,
				firstName: first,
				lastName: last,
				email,
				userType: "COACH",
				clubShortName: club,
				activeFacilityId: facility.facilityId,
			},
			update: { firstName: first, lastName: last, email, userType: "COACH", clubShortName: club, activeFacilityId: facility.facilityId },
		});

		await prisma.userClub.upsert({
			where: { userId_facilityId: { userId: user.userId, facilityId: facility.facilityId } },
			create: { userId: user.userId, clubShortName: FACILITIES[facilityIdx].clubShortName, facilityId: facility.facilityId, role: "COACH" },
			update: { role: "COACH" },
		});

		const spec1 = SPECIALTIES[i % SPECIALTIES.length];
		const spec2 = SPECIALTIES[(i + 7) % SPECIALTIES.length];
		const style1 = STYLES[i % STYLES.length];
		const style2 = STYLES[(i + 3) % STYLES.length];
		const rate = 25 + (i * 3) % 55;

		COACH_PROFILES.push({
			email,
			username: `coach_${first.toLowerCase()}${i}`,
			bio: `${spec1} and ${spec2.toLowerCase()} specialist`,
			experience: `${3 + (i % 15)} years coaching`,
			specialties: [spec1, spec2],
			teachingStyles: [style1, style2],
			rate,
		});
	}

	console.log("");
	for (const cp of COACH_PROFILES) {
		const user = await prisma.user.findFirst({ where: { email: cp.email } });
		if (!user) continue;

		await prisma.coachProfile.upsert({
			where: { userId: user.userId },
			create: {
				userId: user.userId,
				displayUsername: cp.username,
				bio: cp.bio,
				experience: cp.experience,
				specialties: cp.specialties,
				teachingStyles: cp.teachingStyles,
				rate: cp.rate,
				isActive: true,
			},
			update: {
				bio: cp.bio,
				experience: cp.experience,
				specialties: cp.specialties,
				teachingStyles: cp.teachingStyles,
				rate: cp.rate,
				isActive: true,
			},
		});
		console.log(`Coach profile: ${cp.username} (${cp.email})`);
	}

	// 6. Generate 30 extra student users for users page pagination testing
	const STUDENT_FIRST = ["Ari","Blake","Cal","Dana","Eli","Fern","Gio","Hope","Ian","Joy","Kit","Lea","Milo","Nell","Owen","Pia","Quinn","Reed","Sky","Tess","Uri","Val","Wes","Xena","Yael","Zara","Ash","Bria","Clay","Drew"];
	const STUDENT_LAST = ["Frost","Grant","Heath","Irwin","Joyce","Klein","Lowe","Marsh","Noble","Ortiz","Price","Quinn","Reese","Stone","Tyler","Upton","Vance","Walsh","Young","Zane","Bloom","Craig","Dunn","Ellis","Ford","Glenn","Hyde","Kane","Lloyd","Miles"];

	for (let i = 0; i < 30; i++) {
		const first = STUDENT_FIRST[i];
		const last = STUDENT_LAST[i];
		const email = `${first.toLowerCase()}${i}@test.com`;
		// Round-robin across every facility — adding new clubs/facilities to
		// the arrays at the top automatically picks up filler students here.
		const facilityIdx = i % facilityRecords.length;
		const facility = facilityRecords[facilityIdx];
		const club = FACILITIES[facilityIdx].clubShortName; // derived from facility to keep User.clubShortName consistent

		const user = await prisma.user.upsert({
			where: { clerkUserId: `seed_${email}` },
			create: {
				clerkUserId: `seed_${email}`,
				firstName: first,
				lastName: last,
				email,
				userType: "STUDENT",
				clubShortName: club,
				activeFacilityId: facility.facilityId,
			},
			update: { firstName: first, lastName: last, email, userType: "STUDENT", clubShortName: club, activeFacilityId: facility.facilityId },
		});

		await prisma.userClub.upsert({
			where: { userId_facilityId: { userId: user.userId, facilityId: facility.facilityId } },
			create: { userId: user.userId, clubShortName: FACILITIES[facilityIdx].clubShortName, facilityId: facility.facilityId, role: "STUDENT" },
			update: { role: "STUDENT" },
		});
	}
	console.log("Created 30 extra students");

	// 7. Create tags and assign to users
	const TAGS_PER_CLUB = [
		{
			club: "dc-badminton",
			tags: [
				{ name: "beginner", bgColor: "#dbeafe", textColor: "#1e40af" },
				{ name: "intermediate", bgColor: "#dcfce7", textColor: "#166534" },
				{ name: "advanced", bgColor: "#f3e8ff", textColor: "#6b21a8" },
				{ name: "junior", bgColor: "#fef9c3", textColor: "#854d0e" },
				{ name: "tournament player", bgColor: "#fee2e2", textColor: "#991b1b" },
				{ name: "drop-in regular", bgColor: "#ccfbf1", textColor: "#134e4a" },
				{ name: "membership active", bgColor: "#d1fae5", textColor: "#065f46" },
				{ name: "vip", bgColor: "#fce7f3", textColor: "#9d174d" },
			],
		},
		{
			club: "nova-shuttle",
			tags: [
				{ name: "beginner", bgColor: "#dbeafe", textColor: "#1e40af" },
				{ name: "intermediate", bgColor: "#dcfce7", textColor: "#166534" },
				{ name: "advanced", bgColor: "#f3e8ff", textColor: "#6b21a8" },
				{ name: "junior", bgColor: "#fef9c3", textColor: "#854d0e" },
				{ name: "competitive", bgColor: "#fee2e2", textColor: "#991b1b" },
				{ name: "group class", bgColor: "#e0e7ff", textColor: "#3730a3" },
				{ name: "private lesson", bgColor: "#ffedd5", textColor: "#7c2d12" },
				{ name: "trial member", bgColor: "#e0f2fe", textColor: "#0c4a6e" },
			],
		},
	];

	const tagRecords = {};
	for (const clubTags of TAGS_PER_CLUB) {
		tagRecords[clubTags.club] = [];
		for (const t of clubTags.tags) {
			const tag = await prisma.tag.upsert({
				where: {
					clubShortName_name: { clubShortName: clubTags.club, name: t.name },
				},
				create: {
					clubShortName: clubTags.club,
					name: t.name,
					bgColor: t.bgColor,
					textColor: t.textColor,
				},
				update: { bgColor: t.bgColor, textColor: t.textColor },
			});
			tagRecords[clubTags.club].push(tag);
		}
		console.log(`Created ${clubTags.tags.length} tags for ${clubTags.club}`);
	}

	// Assign 3-4 random tags to each seed user
	const allSeedUsers = await prisma.user.findMany({
		where: { clerkUserId: { startsWith: "seed_" } },
		select: { userId: true, clubShortName: true },
	});

	let tagAssignments = 0;
	for (const user of allSeedUsers) {
		const clubTagList = tagRecords[user.clubShortName];
		if (!clubTagList || clubTagList.length === 0) continue;

		// Pick 3-4 random tags
		const count = 3 + Math.floor(Math.random() * 2);
		const shuffled = [...clubTagList].sort(() => Math.random() - 0.5);
		const picked = shuffled.slice(0, count);

		for (const tag of picked) {
			await prisma.userTag.upsert({
				where: {
					userId_tagId: { userId: user.userId, tagId: tag.tagId },
				},
				create: { userId: user.userId, tagId: tag.tagId },
				update: {},
			});
			tagAssignments++;
		}
	}
	console.log(`Assigned ${tagAssignments} tags across ${allSeedUsers.length} seed users`);

	// 8. Create video collections for pagination testing
	const students = await prisma.user.findMany({
		where: { userType: "STUDENT", clerkUserId: { startsWith: "seed_" } },
		take: 15,
		select: { userId: true },
	});

	const COLLECTION_TITLES = [
		"Footwork Drills", "Smash Practice", "Net Kill Training", "Drop Shot Review",
		"Singles Rally", "Doubles Rotation", "Serve Technique", "Defense Patterns",
		"Clear and Drive", "Match Highlights", "Backhand Flick", "Deception Shots",
		"Court Movement", "Jump Smash Form", "Recovery Position", "Cross Court Drops",
		"Lift and Block", "Front Court Play", "Rear Court Drive", "Service Return",
		"Warmup Routine", "Cool Down Drills", "Speed Ladder", "Shadow Footwork",
		"Match Point Analysis", "Tournament Game 1", "Tournament Game 2", "Practice Rally",
		"Slow Motion Review", "Side-by-Side Compare",
	];

	let collectionCount = 0;
	for (let i = 0; i < 30; i++) {
		const student = students[i % students.length];
		if (!student) continue;

		await prisma.videoCollection.upsert({
			where: { collectionId: `seed_collection_${i}` },
			create: {
				collectionId: `seed_collection_${i}`,
				userId: student.userId,
				title: COLLECTION_TITLES[i % COLLECTION_TITLES.length],
				description: `Practice session ${i + 1} — recorded for coaching feedback`,
				mediaType: "URL_VIDEO",
			},
			update: {
				title: COLLECTION_TITLES[i % COLLECTION_TITLES.length],
			},
		});
		collectionCount++;
	}
	console.log(`Created ${collectionCount} video collections`);

	console.log("\nDone! 2 clubs, 4 facilities, ~86 users, ~55 coach profiles, 16 tags, 30 collections seeded.");
}

main()
	.catch((e) => {
		console.error("Seed error:", e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
