import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachDetail as CoachDetailComponent } from "~/app/_components/coaches/CoachDetail";
import { isAnyAdmin } from "~/lib/utils";
import { db } from "~/server/db";
import { binaryToBase64DataUrl } from "~/server/utils/utils";

// Define coach detail type for the page
type CoachDetail = {
	coachProfileId: string;
	userId: string;
	displayUsername: string;
	firstName: string | null;
	lastName: string | null;
	bio: string | null;
	experience: string | null;
	specialties: string[];
	teachingStyles: string[];
	rate: number;
	isVerified: boolean;
	headerImage: string | null;
	profileImageUrl: string | null;
	createdAt: string;
	clubName: string;
};

// Server-side query to get coach data directly from the database
async function getCoach(username: string): Promise<CoachDetail | null> {
	try {
		// Try to find by displayUsername first, then by coachProfileId
		const coach = await db.coachProfile.findFirst({
			where: {
				OR: [{ displayUsername: username }, { coachProfileId: username }],
			},
			include: {
				user: {
					select: {
						userId: true,
						clerkUserId: true,
						userType: true,
						firstName: true,
						lastName: true,
						club: {
							select: {
								clubName: true,
							},
						},
					},
				},
			},
		});

		if (!coach) return null;

		// Generate profile image URL if available
		let profileImageUrl = null;
		if (coach.profileImage) {
			profileImageUrl = binaryToBase64DataUrl(
				coach.profileImage,
				coach.profileImageType || "image/png",
			);
		}

		// Transform coach for frontend
		return {
			coachProfileId: coach.coachProfileId,
			userId: coach.user.userId,
			displayUsername: coach.displayUsername || coach.coachProfileId,
			firstName: coach.user.firstName,
			lastName: coach.user.lastName,
			bio: coach.bio,
			experience: coach.experience,
			specialties: coach.specialties,
			teachingStyles: coach.teachingStyles,
			rate: coach.rate,
			isVerified: coach.isVerified,
			headerImage: coach.headerImage,
			profileImageUrl,
			createdAt: coach.createdAt.toISOString(),
			clubName: coach.user.club.clubName,
		};
	} catch (error) {
		console.error("Error fetching coach:", error);
		return null;
	}
}

export async function generateMetadata(props: any): Promise<Metadata> {
	const { username } = await props.params;
	const coach = await getCoach(username);

	if (!coach) {
		return {
			title: "Coach Not Found | Facility Presence",
		};
	}

	const fullName = `${coach.firstName || ""} ${coach.lastName || ""}`.trim();

	return {
		title: `${fullName} | Coach | Facility Presence`,
		description: coach.bio || `${fullName}, a coach on Facility Presence`,
	};
}

export default async function CoachProfilePage(props: any) {
	const { username } = await props.params;
	const [coach, { userId: viewerClerkId }] = await Promise.all([
		getCoach(username),
		auth(),
	]);

	if (!coach) {
		notFound();
	}

	// Determine if the viewer can edit: must be the coach owner or an admin.
	// We resolve the viewer's DB record to check userType.
	let canEdit = false;
	if (viewerClerkId) {
		const viewer = await db.user.findUnique({
			where: { clerkUserId: viewerClerkId },
			select: { userId: true, userType: true },
		});
		if (viewer) {
			canEdit = viewer.userId === coach.userId || isAnyAdmin(viewer);
		}
	}

	return (
		<div className="container mx-auto px-4 py-8">
			<div className="mx-auto max-w-7xl">
				<CoachDetailComponent coach={coach} canEdit={canEdit} />
			</div>
		</div>
	);
}
