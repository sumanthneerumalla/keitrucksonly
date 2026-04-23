import { clerkClient } from "@clerk/nextjs/server";
import { Prisma, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { getCurrentWeekRange } from "~/server/utils/dateUtils";
import { generateUniqueUsername } from "~/server/utils/generateUsername";
import {
	ROLE_HIERARCHY,
	canAssignRole,
	canManageUser,
	formatUserForFrontend,
	getCurrentUser,
	isAnyAdmin,
	isPlatformAdmin,
	isSameClub,
	processBase64Image,
} from "~/server/utils/utils";

/**
 * Helper function to process profile image data from input
 * @param profileImageData Base64 encoded image data
 * @returns Object containing binary data and image type, or null if no image provided, or explicit null to delete
 */
function processProfileImageInput(
	profileImageData?: string,
):
	| { profileImage: Buffer; profileImageType: string }
	| null
	| { profileImage: null } {
	// If undefined, return null (no change)
	if (profileImageData === undefined) return null;

	// If empty string, return explicit null to delete the image
	if (profileImageData === "") {
		return { profileImage: null };
	}

	try {
		// Process the image data for a valid base64 string
		const binaryData = processBase64Image(profileImageData);
		return {
			profileImage: binaryData,
			profileImageType: "image/png",
		};
	} catch (error) {
		console.error("Error processing profile image:", error);
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				error instanceof Error
					? error.message
					: "Failed to process profile image",
		});
	}
}

/**
 * Helper function to prepare profile data for saving
 * @param input Input data with possible profileImage field
 * @returns Prepared data object with processed image data if available
 */
function prepareProfileData<T extends { profileImage?: string }>(
	input: T,
): Omit<T, "profileImage"> & {
	profileImage?: Uint8Array | null;
	profileImageType?: string;
} {
	// Process profile image if provided
	const processedImage = processProfileImageInput(input.profileImage);

	// Prepare data object, excluding profileImage from input
	const { profileImage, ...profileData } = input;

	// Create the base return object with proper type
	const result = { ...profileData } as Omit<T, "profileImage"> & {
		profileImage?: Uint8Array | null;
		profileImageType?: string;
	};

	// Handle different cases based on processedImage result
	if (processedImage) {
		// Set profileImage (could be null for deletion)
		if (processedImage.profileImage === null) {
			result.profileImage = null;
		} else {
			// Convert Buffer to Uint8Array for Prisma with proper ArrayBuffer
			const buffer = processedImage.profileImage.buffer.slice(
				processedImage.profileImage.byteOffset,
				processedImage.profileImage.byteOffset +
					processedImage.profileImage.byteLength,
			);
			result.profileImage = new Uint8Array(buffer);
		}

		// Only set profileImageType if it exists (won't exist for deletion case)
		if ("profileImageType" in processedImage) {
			result.profileImageType = processedImage.profileImageType;
		}
	}

	return result;
}

// ============================================================
// INPUT SCHEMAS
// ============================================================

const updateProfileSchema = z.object({
	firstName: z
		.string()
		.min(1)
		.max(100)
		.trim()
		.regex(/^[\p{L}\p{M}' -]+$/u, "Name contains invalid characters")
		.optional(),
	lastName: z
		.string()
		.min(1)
		.max(100)
		.trim()
		.regex(/^[\p{L}\p{M}' -]+$/u, "Name contains invalid characters")
		.optional(),
	email: z.string().email().optional(),
	profileImage: z.string().url().optional(),
	timeZone: z
		.string()
		.transform((val) => (val.trim() === "" ? undefined : val))
		.pipe(
			z
				.string()
				.regex(/^\/|^[A-Za-z]+(\/[A-Za-z_]+)+$|^UTC$/, "Invalid timezone")
				.optional(),
		)
		.optional(),
	// clubShortName intentionally omitted — club changes go through joinClub /
	// switchClub mutations which keep activeFacilityId in sync. Adding it here
	// would bypass that and leave activeFacilityId pointing at the wrong club.
});

const updateStudentProfileSchema = z.object({
	displayUsername: z
		.string()
		.min(3, "Username must be at least 3 characters")
		.max(30, "Username must be 30 characters or less")
		.regex(
			/^[a-zA-Z][a-zA-Z0-9_]*$/,
			"Username must start with a letter and can only contain letters, numbers, and underscores",
		)
		.transform((val) => val.toLowerCase())
		.optional(),
	skillLevel: z.string().optional(),
	goals: z.string().optional(),
	bio: z.string().optional(),
	profileImage: z
		.string()
		.refine(
			(val) => !val || val.length <= 5 * 1024 * 1024,
			"Profile image must be 5MB or less",
		)
		.optional(),
});

const switchUserTypeSchema = z.object({
	userType: z.enum([
		UserType.STUDENT,
		UserType.COACH,
		UserType.FACILITY,
		UserType.CLUB_ADMIN,
	] as const),
});

const updateCoachProfileSchema = z.object({
	displayUsername: z
		.string()
		.min(3, "Username must be at least 3 characters")
		.max(30, "Username must be 30 characters or less")
		.regex(
			/^[a-zA-Z][a-zA-Z0-9_]*$/,
			"Username must start with a letter and can only contain letters, numbers, and underscores",
		)
		.transform((val) => val.toLowerCase())
		.optional(),
	bio: z.string().max(300, "Bio must be 300 characters or less").optional(),
	experience: z
		.string()
		.max(1000, "Experience must be 1000 characters or less")
		.optional(),
	specialties: z.array(z.string()).optional(),
	teachingStyles: z.array(z.string()).optional(),
	headerImage: z
		.union([z.string().url(), z.string().length(0), z.null()])
		.optional(),
	rate: z.number().int().min(0).optional(),
	isActive: z.boolean().optional(),
	profileImage: z
		.string()
		.refine(
			(val) => !val || val.length <= 5 * 1024 * 1024,
			"Profile image must be 5MB or less",
		)
		.optional(),
});

// ============================================================

export const userRouter = createTRPCRouter({
	// Get or create user profile on first sign-in
	getOrCreateProfile: protectedProcedure.query(async ({ ctx }) => {
		// First, always try to find existing user
		let user = await ctx.db.user.findUnique({
			where: { clerkUserId: ctx.auth.userId },
			include: {
				studentProfile: true,
				coachProfile: true,
				club: true,
			},
		});

		if (!user) {
			try {
				// Use upsert to handle race conditions - if two requests come in simultaneously,
				// only one will create the user, the other will return the existing one
				user = await ctx.db.user.upsert({
					where: { clerkUserId: ctx.auth.userId },
					update: {}, // Do nothing if it exists
					create: {
						clerkUserId: ctx.auth.userId,
						userType: UserType.STUDENT, // Default to student
					},
					include: {
						studentProfile: true,
						coachProfile: true,
						club: true,
					},
				});

				console.log(
					`Created new user profile for Clerk user: ${ctx.auth.userId}`,
				);

				// Backfill per-facility UserClub rows for the default club
				if (user.clubShortName) {
					const defaultFacilities = await ctx.db.clubFacility.findMany({
						where: { clubShortName: user.clubShortName, isActive: true },
						orderBy: { position: "asc" },
						select: { facilityId: true },
					});

					for (const f of defaultFacilities) {
						await ctx.db.userClub.upsert({
							where: {
								userId_facilityId: {
									userId: user.userId,
									facilityId: f.facilityId,
								},
							},
							create: {
								userId: user.userId,
								clubShortName: user.clubShortName,
								facilityId: f.facilityId,
								role: user.userType,
							},
							update: {},
						});
					}

					// Set active facility if not already set
					if (!user.activeFacilityId && defaultFacilities[0]) {
						await ctx.db.user.update({
							where: { userId: user.userId },
							data: { activeFacilityId: defaultFacilities[0].facilityId },
						});
						user = await ctx.db.user.findUnique({
							where: { clerkUserId: ctx.auth.userId },
							include: {
								studentProfile: true,
								coachProfile: true,
								club: true,
							},
						});
						if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
					}
				}
			} catch (error) {
				// If there's a unique constraint violation, fetch the existing user
				// This handles the extremely rare case of a race condition
				user = await ctx.db.user.findUnique({
					where: { clerkUserId: ctx.auth.userId },
					include: {
						studentProfile: true,
						coachProfile: true,
						club: true,
					},
				});

				if (!user) {
					throw new Error("Failed to create or retrieve user profile");
				}
			}
		}

		// Verify user exists before proceeding
		if (!user) {
			throw new Error(
				"Critical error: User should exist by this point but doesn't. This indicates a serious issue with user creation logic.",
			);
		}

		// Create default profiles based on user type if they don't exist
		if (isAnyAdmin(user)) {
			// Admin users should have both profiles
			if (!user.studentProfile) {
				await ctx.db.studentProfile.create({
					data: {
						userId: user.userId,
						skillLevel: "Intermediate",
						goals: "Improve overall badminton skills and techniques",
						bio: "Admin user with access to all platform features",
					},
				});
			}
			if (!user.coachProfile) {
				// Create coach profile with inline username generation
				await ctx.db.coachProfile.create({
					data: {
						userId: user.userId,
						displayUsername: await generateUniqueUsername(user, ctx.db),
						rate: 50,
						bio: "Admin user with coaching capabilities",
						experience: "Platform administrator with coaching access",
						specialties: ["Administration", "Platform Management"],
						teachingStyles: ["Flexible", "Adaptive"],
					},
				});
			}
			// Refetch user with profiles
			user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				include: {
					studentProfile: true,
					coachProfile: true,
					club: true,
				},
			});
		} else if (user.userType === UserType.STUDENT && !user.studentProfile) {
			// Create default student profile if missing
			await ctx.db.studentProfile.create({
				data: {
					userId: user.userId,
					skillLevel: "Beginner",
					goals: "Learn and improve badminton skills",
					bio: "New badminton student eager to learn",
				},
			});
			user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				include: {
					studentProfile: true,
					coachProfile: true,
					club: true,
				},
			});
		} else if (user.userType === UserType.COACH && !user.coachProfile) {
			// Create default coach profile if missing with inline username generation
			await ctx.db.coachProfile.create({
				data: {
					userId: user.userId,
					displayUsername: await generateUniqueUsername(user, ctx.db),
					rate: 40,
					bio: "Experienced badminton coach",
					experience: "Several years of badminton coaching experience",
					specialties: ["Fundamentals", "Technique"],
					teachingStyles: ["Patient", "Structured"],
				},
			});
			user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				include: {
					studentProfile: true,
					coachProfile: true,
					club: true,
				},
			});
		}

		return formatUserForFrontend(user as NonNullable<typeof user>);
	}),

	// Update basic user profile.
	// NOTE: Does NOT update clubShortName. Club changes must go through
	// `joinClub` or `switchClub` to keep `activeFacilityId` in sync.
	updateProfile: protectedProcedure
		.input(updateProfileSchema)
		.mutation(async ({ ctx, input }) => {
			const dataToUpdate = {
				firstName: input.firstName,
				lastName: input.lastName,
				email: input.email,
				profileImage: input.profileImage,
				timeZone: input.timeZone,
			};

			const user = await ctx.db.user.update({
				where: { clerkUserId: ctx.auth.userId },
				data: dataToUpdate,
				include: {
					studentProfile: true,
					coachProfile: true,
					club: true,
				},
			});

			return formatUserForFrontend(user);
		}),

	// Returns a list of clubs for selector UIs.
	// scope="all"         → all clubs in the system (admin-only).
	// scope="memberships" → only the clubs the calling user has joined (any role, no admin gate).
	getAvailableClubs: protectedProcedure
		.input(
			z
				.object({
					scope: z.enum(["all", "memberships"]).optional().default("all"),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const scope = input?.scope ?? "all";

			if (scope === "all" && !isPlatformAdmin(user)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only admins can view all available clubs.",
				});
			}

			if (scope === "memberships") {
				const memberships = await ctx.db.userClub.findMany({
					where: { userId: user.userId },
					distinct: ["clubShortName"],
					include: {
						club: { select: { clubShortName: true, clubName: true } },
					},
					orderBy: { club: { clubName: "asc" } },
				});

				return memberships
					.filter(
						(m) =>
							m.club.clubShortName.trim().length > 0 &&
							m.club.clubName.trim().length > 0,
					)
					.map((m) => ({
						clubShortName: m.club.clubShortName,
						clubName: m.club.clubName,
					}));
			}

			const clubs = await ctx.db.club.findMany({
				select: {
					clubShortName: true,
					clubName: true,
				},
				orderBy: {
					clubName: "asc",
				},
			});

			return clubs
				.map((club) => ({
					clubShortName: club.clubShortName,
					clubName: club.clubName,
				}))
				.filter(
					(c) =>
						c.clubShortName.trim().length > 0 && c.clubName.trim().length > 0,
				)
				.sort((a, b) => a.clubName.localeCompare(b.clubName));
		}),

	// Switch user type — restricted to roles valid in UserClub (excludes PLATFORM_ADMIN)
	switchUserType: protectedProcedure
		.input(switchUserTypeSchema)
		.mutation(async ({ ctx, input }) => {
			const currentUser = await getCurrentUser(ctx);

			if (!currentUser.activeFacilityId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No active facility set. Switch to a facility first.",
				});
			}

			// Only allow switching to a role the user actually holds at their active facility.
			// Note: UserClub has @@unique([userId, facilityId]), so a user can only hold one
			// role per facility — meaning this check will only pass for their exact assigned role.
			// If multi-role support per facility is needed later, this constraint must be revisited.
			const membership = await ctx.db.userClub.findUnique({
				where: {
					userId_facilityId: {
						userId: currentUser.userId,
						facilityId: currentUser.activeFacilityId,
					},
				},
				select: { role: true },
			});

			if (!membership || membership.role !== input.userType) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You do not have this role at your active facility.",
				});
			}

			const user = await ctx.db.user.update({
				where: { clerkUserId: ctx.auth.userId },
				data: { userType: input.userType },
				include: {
					studentProfile: true,
					coachProfile: true,
				},
			});

			// Create the appropriate profile(s) if they don't exist
			if (input.userType === UserType.CLUB_ADMIN) {
				// CLUB_ADMIN gets both profiles
				if (!user.studentProfile) {
					await ctx.db.studentProfile.create({
						data: {
							userId: user.userId,
							skillLevel: "Intermediate",
							goals: "Improve overall badminton skills and techniques",
							bio: "Admin user with access to all platform features",
						},
					});
				}
				if (!user.coachProfile) {
					await ctx.db.coachProfile.create({
						data: {
							userId: user.userId,
							displayUsername: await generateUniqueUsername(user, ctx.db),
							rate: 50,
							bio: "Admin user with coaching capabilities",
							experience: "Platform administrator with coaching access",
							specialties: ["Administration", "Platform Management"],
							teachingStyles: ["Flexible", "Adaptive"],
						},
					});
				}
			} else if (input.userType === UserType.STUDENT && !user.studentProfile) {
				await ctx.db.studentProfile.create({
					data: {
						userId: user.userId,
						skillLevel: "Beginner",
						goals: "Learn and improve badminton skills",
						bio: "New badminton student eager to learn",
					},
				});
			} else if (input.userType === UserType.COACH && !user.coachProfile) {
				await ctx.db.coachProfile.create({
					data: {
						userId: user.userId,
						displayUsername: await generateUniqueUsername(user, ctx.db),
						rate: 40,
						bio: "Experienced badminton coach",
						experience: "Several years of badminton coaching experience",
						specialties: ["Fundamentals", "Technique"],
						teachingStyles: ["Patient", "Structured"],
					},
				});
			}

			return ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				include: {
					studentProfile: true,
					coachProfile: true,
				},
			});
		}),

	// Update student profile
	updateStudentProfile: protectedProcedure
		.input(updateStudentProfileSchema)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
			});

			if (!user) {
				throw new Error("User not found");
			}

			// Prepare data for saving using helper function
			const dataToSave = prepareProfileData(input);

			// Create student profile if it doesn't exist
			const existingProfile = await ctx.db.studentProfile.findUnique({
				where: { userId: user.userId },
			});

			if (!existingProfile) {
				const createData: any = {
					userId: user.userId,
					displayUsername: dataToSave.displayUsername,
					skillLevel: dataToSave.skillLevel,
					goals: dataToSave.goals,
					bio: dataToSave.bio,
					profileImageType: dataToSave.profileImageType,
				};

				if (dataToSave.profileImage !== undefined) {
					createData.profileImage = dataToSave.profileImage;
				}

				return ctx.db.studentProfile.create({
					data: createData,
				});
			}

			const updateData: any = {
				displayUsername: dataToSave.displayUsername,
				skillLevel: dataToSave.skillLevel,
				goals: dataToSave.goals,
				bio: dataToSave.bio,
				profileImageType: dataToSave.profileImageType,
			};

			if (dataToSave.profileImage !== undefined) {
				updateData.profileImage = dataToSave.profileImage;
			}

			return ctx.db.studentProfile.update({
				where: { userId: user.userId },
				data: updateData,
			});
		}),

	// Update coach profile
	updateCoachProfile: protectedProcedure
		.input(updateCoachProfileSchema)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
			});

			if (!user) {
				throw new Error("User not found");
			}

			// Prepare data for saving using helper function
			const dataToSave = prepareProfileData(input);

			// Create coach profile if it doesn't exist
			const existingProfile = await ctx.db.coachProfile.findUnique({
				where: { userId: user.userId },
			});

			if (!existingProfile) {
				// If no displayUsername is provided, generate one inline
				const displayUsername =
					dataToSave.displayUsername ||
					(await generateUniqueUsername(user, ctx.db));

				const createData: any = {
					userId: user.userId,
					displayUsername,
					bio: dataToSave.bio,
					experience: dataToSave.experience,
					specialties: dataToSave.specialties || [],
					teachingStyles: dataToSave.teachingStyles || [],
					headerImage: dataToSave.headerImage,
					rate: dataToSave.rate || 0,
					isActive: dataToSave.isActive,
					profileImageType: dataToSave.profileImageType,
				};

				if (dataToSave.profileImage !== undefined) {
					createData.profileImage = dataToSave.profileImage;
				}

				return ctx.db.coachProfile.create({
					data: createData,
				});
			}

			const updateData: any = {
				displayUsername: dataToSave.displayUsername,
				bio: dataToSave.bio,
				experience: dataToSave.experience,
				specialties: dataToSave.specialties,
				teachingStyles: dataToSave.teachingStyles,
				headerImage: dataToSave.headerImage,
				rate: dataToSave.rate,
				isActive: dataToSave.isActive,
				profileImageType: dataToSave.profileImageType,
			};

			if (dataToSave.profileImage !== undefined) {
				updateData.profileImage = dataToSave.profileImage;
			}

			return ctx.db.coachProfile.update({
				where: { userId: user.userId },
				data: updateData,
			});
		}),

	// Get coach dashboard metrics
	getCoachDashboardMetrics: protectedProcedure.query(async ({ ctx }) => {
		// Get the current user
		const user = await getCurrentUser(ctx);

		// Check if user has coaching privileges (COACH or ADMIN only)
		if (user.userType !== UserType.COACH && !isAnyAdmin(user)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only coaches and admins can access dashboard metrics.",
			});
		}

		try {
			// Calculate unique students with media accessible to coach
			// This includes all students who have uploaded media (not soft-deleted)
			const studentCount = await ctx.db.user.count({
				where: {
					userType: UserType.STUDENT,
					videoCollections: {
						some: {
							isDeleted: false,
							...(user.userType === UserType.COACH
								? { assignedCoachId: user.userId }
								: {}),
							media: {
								some: {
									isDeleted: false,
								},
							},
						},
					},
				},
			});

			// Calculate weekly coaching notes count (current week Monday-Sunday)
			const { startOfWeek, endOfWeek } = getCurrentWeekRange();

			const weeklyNotesCount = await ctx.db.mediaCoachNote.count({
				where: {
					coachId: user.userId,
					createdAt: {
						gte: startOfWeek,
						lte: endOfWeek,
					},
				},
			});

			return {
				studentCount,
				weeklyNotesCount,
				weekRange: {
					startOfWeek,
					endOfWeek,
				},
			};
		} catch (error) {
			console.error("Error fetching coach dashboard metrics:", error);
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to fetch dashboard metrics. Please try again.",
			});
		}
	}),

	// Switch the current user's active club. Validates the user has a UserClub row for the
	// target club, then updates User.clubShortName + User.userType in-place so all existing
	// authorization logic continues to work without any changes.
	switchClub: protectedProcedure
		.input(
			z.object({
				clubShortName: z
					.string()
					.regex(/^[a-zA-Z0-9-]+$/)
					.min(1)
					.max(50),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const sanitized = input.clubShortName.trim().toLowerCase();

			if (sanitized === user.clubShortName) {
				// Already on this club — no-op
				return { clubShortName: user.clubShortName, userType: user.userType };
			}

			// Find the first facility membership for the user in the target club
			const firstMembership = await ctx.db.userClub.findFirst({
				where: {
					userId: user.userId,
					clubShortName: sanitized,
					facility: { isActive: true },
				},
				orderBy: { facility: { position: "asc" } },
			});

			let targetRole: UserType;
			let targetFacilityId: string | null;

			if (!firstMembership) {
				// Non-admins must have an explicit UserClub row
				if (!isPlatformAdmin(user)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You are not a member of this club.",
					});
				}
				// Platform admins can impersonate any club — find its first active facility
				const club = await ctx.db.club.findUnique({
					where: { clubShortName: sanitized },
				});
				if (!club) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Club not found.",
					});
				}
				const firstFacility = await ctx.db.clubFacility.findFirst({
					where: { clubShortName: sanitized, isActive: true },
					orderBy: { position: "asc" },
					select: { facilityId: true },
				});
				targetRole = UserType.PLATFORM_ADMIN;
				targetFacilityId = firstFacility?.facilityId ?? null;
			} else {
				targetRole = firstMembership.role;
				targetFacilityId = firstMembership.facilityId;
			}

			const updated = await ctx.db.user.update({
				where: { userId: user.userId },
				data: {
					clubShortName: sanitized,
					userType: targetRole,
					activeFacilityId: targetFacilityId,
				},
				select: { clubShortName: true, userType: true, activeFacilityId: true },
			});

			return updated;
		}),

	// Switch the user's active facility. Looks up the per-facility UserClub row to get
	// the user's role at that facility, then updates User.activeFacilityId, clubShortName, and userType.
	switchFacility: protectedProcedure
		.input(z.object({ facilityId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			if (input.facilityId === user.activeFacilityId) {
				return {
					activeFacilityId: user.activeFacilityId,
					userType: user.userType,
				};
			}

			// Look up the user's membership row for this specific facility
			const membership = await ctx.db.userClub.findUnique({
				where: {
					userId_facilityId: {
						userId: user.userId,
						facilityId: input.facilityId,
					},
				},
				include: {
					facility: {
						select: { clubShortName: true, isActive: true },
					},
				},
			});

			let targetClubShortName: string;
			let targetRole: UserType;

			if (!membership || !membership.facility.isActive) {
				// Platform admins can switch to any active facility in any club,
				// even without an explicit UserClub row (mirrors switchClub bypass).
				if (!isPlatformAdmin(user)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You do not have access to this facility.",
					});
				}
				const facility = await ctx.db.clubFacility.findUnique({
					where: { facilityId: input.facilityId },
					select: { clubShortName: true, isActive: true },
				});
				if (!facility || !facility.isActive) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Facility not found or inactive.",
					});
				}
				targetClubShortName = facility.clubShortName;
				targetRole = UserType.PLATFORM_ADMIN;
			} else {
				targetClubShortName = membership.facility.clubShortName;
				targetRole = membership.role;
			}

			// Update all three active fields on User
			const updated = await ctx.db.user.update({
				where: { userId: user.userId },
				data: {
					activeFacilityId: input.facilityId,
					clubShortName: targetClubShortName,
					userType: targetRole,
				},
				select: { activeFacilityId: true, clubShortName: true, userType: true },
			});

			return updated;
		}),

	// Typeahead search across all clubs — open to any authenticated user.
	// Requires at least 4 characters to prevent full-table scans.
	searchClubs: protectedProcedure
		.input(
			z.object({
				query: z.string().min(4).max(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const normalized = input.query.trim().toLowerCase();

			const clubs = await ctx.db.club.findMany({
				where: {
					OR: [
						{ clubName: { contains: normalized, mode: "insensitive" } },
						{ clubShortName: { contains: normalized, mode: "insensitive" } },
					],
				},
				select: { clubShortName: true, clubName: true },
				orderBy: { clubName: "asc" },
				take: 20,
			});

			return clubs.map((c) => ({
				clubShortName: c.clubShortName,
				clubName: c.clubName,
			}));
		}),

	// Create a UserClub membership row for the calling user, then make it the active club.
	// Idempotent — if already a member, just switches active club.
	joinClub: protectedProcedure
		.input(
			z.object({
				clubShortName: z
					.string()
					.regex(/^[a-zA-Z0-9-]+$/)
					.min(1)
					.max(50),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const sanitized = input.clubShortName.trim().toLowerCase();

			// Verify club exists
			const club = await ctx.db.club.findUnique({
				where: { clubShortName: sanitized },
				select: { clubShortName: true, clubName: true },
			});

			if (!club) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Club not found.",
				});
			}

			// Get all active facilities for this club
			const clubFacilities = await ctx.db.clubFacility.findMany({
				where: { clubShortName: sanitized, isActive: true },
				orderBy: { position: "asc" },
				select: { facilityId: true },
			});

			// Create one membership row per facility (idempotent — skip if already exists)
			for (const f of clubFacilities) {
				await ctx.db.userClub.upsert({
					where: {
						userId_facilityId: {
							userId: user.userId,
							facilityId: f.facilityId,
						},
					},
					create: {
						userId: user.userId,
						clubShortName: sanitized,
						facilityId: f.facilityId,
						role: UserType.STUDENT,
					},
					update: {},
				});
			}

			// Switch active club + set active facility to the first one
			const firstFacilityId = clubFacilities[0]?.facilityId ?? null;
			await ctx.db.user.update({
				where: { userId: user.userId },
				data: {
					clubShortName: sanitized,
					userType: UserType.STUDENT,
					activeFacilityId: firstFacilityId,
				},
			});

			return { clubShortName: sanitized, clubName: club.clubName };
		}),

	// Returns all clubs the current user is a member of (deduplicated from per-facility rows).
	// Used by the navbar club switcher.
	getClubMemberships: protectedProcedure.query(async ({ ctx }) => {
		const user = await getCurrentUser(ctx);

		const memberships = await ctx.db.userClub.findMany({
			where: { userId: user.userId },
			include: {
				club: {
					select: {
						clubShortName: true,
						clubName: true,
					},
				},
			},
			orderBy: { club: { clubName: "asc" } },
		});

		// Deduplicate by clubShortName — take the first row per club
		const seen = new Set<string>();
		const deduped = memberships.filter((m) => {
			if (seen.has(m.clubShortName)) return false;
			seen.add(m.clubShortName);
			return true;
		});

		const result = deduped.map((m) => ({
			id: m.id,
			clubShortName: m.clubShortName,
			clubName: m.club.clubName,
			role: m.role,
			joinedAt: m.joinedAt,
			isActive: m.clubShortName === user.clubShortName,
		}));

		// Platform admins may be active in a club with no UserClub row (impersonation).
		// Ensure the current active club always appears in the list so the selector label works.
		const hasActiveClub = result.some((m) => m.isActive);
		if (!hasActiveClub && isPlatformAdmin(user) && user.clubShortName) {
			const activeClub = await ctx.db.club.findUnique({
				where: { clubShortName: user.clubShortName },
				select: { clubShortName: true, clubName: true },
			});
			if (activeClub) {
				result.unshift({
					id: "synthetic",
					clubShortName: activeClub.clubShortName,
					clubName: activeClub.clubName,
					role: UserType.PLATFORM_ADMIN,
					joinedAt: new Date(0),
					isActive: true,
				});
			}
		}

		return result;
	}),

	// ============================================================
	// USER MANAGEMENT (Phase 2)
	// ============================================================

	// List users in the caller's club with their facility memberships.
	listClubUsers: facilityProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				limit: z.number().int().min(10).max(50).default(20),
				search: z.string().optional(),
				facilityId: z.string().optional(),
				role: z.nativeEnum(UserType).optional(),
				tagIds: z.array(z.string()).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { page, limit, search, facilityId, role, tagIds } = input;
			const clubShortName = ctx.user.clubShortName;

			// Build membership filter for the caller's club
			const membershipFilter: Record<string, unknown> = { clubShortName };
			if (facilityId) membershipFilter.facilityId = facilityId;
			if (role) membershipFilter.role = role;

			const baseWhere: Record<string, unknown> = {
				clubMemberships: { some: membershipFilter },
			};

			// Tag filter goes on the User model level
			if (tagIds && tagIds.length > 0) {
				baseWhere.userTags = { some: { tagId: { in: tagIds } } };
			}

			const whereClause = search
				? {
						AND: [
							baseWhere,
							{
								OR: [
									{
										firstName: {
											contains: search,
											mode: "insensitive" as const,
										},
									},
									{
										lastName: {
											contains: search,
											mode: "insensitive" as const,
										},
									},
									{ email: { contains: search, mode: "insensitive" as const } },
								],
							},
						],
					}
				: baseWhere;

			const [total, users] = await Promise.all([
				ctx.db.user.count({ where: whereClause }),
				ctx.db.user.findMany({
					where: whereClause,
					skip: (page - 1) * limit,
					take: limit,
					orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
					select: {
						userId: true,
						firstName: true,
						lastName: true,
						email: true,
						userType: true,
						activeFacilityId: true,
						clubShortName: true,
						clubMemberships: {
							where: { clubShortName },
							include: {
								facility: {
									select: {
										facilityId: true,
										name: true,
									},
								},
							},
							orderBy: { facility: { position: "asc" } },
						},
						userTags: {
							include: { tag: true },
						},
					},
				}),
			]);

			return {
				users,
				pagination: {
					total,
					page,
					limit,
					pageCount: Math.ceil(total / limit),
				},
			};
		}),

	// Export club users as CSV data (club admin+ only).
	// Returns all users matching the current filters (no pagination).
	exportClubUsers: clubAdminProcedure
		.input(
			z.object({
				search: z.string().optional(),
				facilityId: z.string().optional(),
				role: z.nativeEnum(UserType).optional(),
				tagIds: z.array(z.string()).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { search, facilityId, role, tagIds } = input;
			const clubShortName = ctx.user.clubShortName;

			const membershipFilter: Record<string, unknown> = { clubShortName };
			if (facilityId) membershipFilter.facilityId = facilityId;
			if (role) membershipFilter.role = role;

			const baseWhere: Record<string, unknown> = {
				clubMemberships: { some: membershipFilter },
			};

			if (tagIds && tagIds.length > 0) {
				baseWhere.userTags = { some: { tagId: { in: tagIds } } };
			}

			const whereClause = search
				? {
						AND: [
							baseWhere,
							{
								OR: [
									{ firstName: { contains: search, mode: "insensitive" as const } },
									{ lastName: { contains: search, mode: "insensitive" as const } },
									{ email: { contains: search, mode: "insensitive" as const } },
								],
							},
						],
					}
				: baseWhere;

			const users = await ctx.db.user.findMany({
				where: whereClause,
				orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
				select: {
					firstName: true,
					lastName: true,
					email: true,
				},
			});

			return { users };
		}),

	// Create a new user (Clerk account + local User + UserClub).
	// When role=CLUB_ADMIN and newClub is provided, creates a new club + default facility first.
	createUser: facilityProcedure
		.input(
			z.object({
				firstName: z.string().min(1).max(100).trim(),
				lastName: z.string().min(1).max(100).trim(),
				email: z.string().email(),
				role: z.nativeEnum(UserType),
				facilityId: z.string().optional(),
				newClub: z
					.object({
						clubName: z.string().min(1).max(100).trim(),
						clubShortName: z
							.string()
							.min(1)
							.max(50)
							.regex(/^[a-z0-9-]+$/, "Lowercase alphanumeric and hyphens only")
							.trim(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Validate role ceiling
			if (!canAssignRole(ctx.user.userType, input.role)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot assign this role.",
				});
			}

			// New club creation — PLATFORM_ADMIN + CLUB_ADMIN role only
			let facilityId = input.facilityId;
			let clubShortName = ctx.user.clubShortName;

			if (input.newClub) {
				if (!isPlatformAdmin(ctx.user)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Only platform admins can create new clubs.",
					});
				}
				if (input.role !== UserType.CLUB_ADMIN) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "New clubs can only be created with a Club Admin.",
					});
				}

				// Check shortname not taken
				const existing = await ctx.db.club.findUnique({
					where: { clubShortName: input.newClub.clubShortName },
				});
				if (existing) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A club with this short name already exists.",
					});
				}

				// Create club + default facility
				await ctx.db.club.create({
					data: {
						clubShortName: input.newClub.clubShortName,
						clubName: input.newClub.clubName,
					},
				});

				const newFacility = await ctx.db.clubFacility.create({
					data: {
						clubShortName: input.newClub.clubShortName,
						name: "Main",
						position: 0,
					},
				});

				facilityId = newFacility.facilityId;
				clubShortName = input.newClub.clubShortName;
			}

			if (!facilityId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Facility is required.",
				});
			}

			// Validate facility belongs to the target club (skip if we just created it)
			if (!input.newClub) {
				const facility = await ctx.db.clubFacility.findUnique({
					where: { facilityId },
					select: { clubShortName: true },
				});

				if (!facility || facility.clubShortName !== clubShortName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Facility does not belong to your club.",
					});
				}
			}

			const clerk = await clerkClient();
			let clerkUserId: string;

			try {
				// Try creating a new Clerk account
				const clerkUser = await clerk.users.createUser({
					emailAddress: [input.email],
					firstName: input.firstName,
					lastName: input.lastName,
					skipPasswordRequirement: true,
				});
				clerkUserId = clerkUser.id;
			} catch (err: any) {
				// If email already exists in Clerk, find the existing user
				if (
					err?.errors?.[0]?.code === "form_identifier_exists" ||
					err?.status === 422
				) {
					const existingClerkUsers = await clerk.users.getUserList({
						emailAddress: [input.email],
					});
					const existingClerk = existingClerkUsers.data[0];

					if (!existingClerk) {
						throw new TRPCError({
							code: "INTERNAL_SERVER_ERROR",
							message: "Email exists in auth system but user not found.",
						});
					}
					clerkUserId = existingClerk.id;
				} else {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create user account.",
					});
				}
			}

			// Find or create the local User row
			let user = await ctx.db.user.findUnique({
				where: { clerkUserId },
			});

			if (!user) {
				user = await ctx.db.user.create({
					data: {
						clerkUserId,
						firstName: input.firstName,
						lastName: input.lastName,
						email: input.email,
						userType: input.role,
						clubShortName,
						activeFacilityId: facilityId,
					},
				});
			}

			// Check if already at this facility
			const existingMembership = await ctx.db.userClub.findUnique({
				where: {
					userId_facilityId: {
						userId: user.userId,
						facilityId,
					},
				},
			});

			if (existingMembership) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "User is already a member of this facility.",
				});
			}

			// Create UserClub row
			await ctx.db.userClub.create({
				data: {
					userId: user.userId,
					clubShortName,
					facilityId,
					role: input.role,
				},
			});

			// Set the new facility as the user's active context
			await ctx.db.user.update({
				where: { userId: user.userId },
				data: {
					clubShortName,
					activeFacilityId: facilityId,
					userType: input.role,
				},
			});

			return { userId: user.userId, email: user.email };
		}),

	// Update a user's role at a specific facility.
	updateUserRole: clubAdminProcedure
		.input(
			z.object({
				userId: z.string(),
				facilityId: z.string(),
				newRole: z.nativeEnum(UserType),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!canAssignRole(ctx.user.userType, input.newRole)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot assign this role.",
				});
			}

			// Verify membership exists and is in caller's club
			const membership = await ctx.db.userClub.findUnique({
				where: {
					userId_facilityId: {
						userId: input.userId,
						facilityId: input.facilityId,
					},
				},
				select: { id: true, clubShortName: true, role: true },
			});

			if (!membership || membership.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Membership not found in your club.",
				});
			}

			// Caller must outrank the user's current role
			if (!canManageUser(ctx.user.userType, membership.role)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot modify a user with an equal or higher role.",
				});
			}

			await ctx.db.userClub.update({
				where: {
					userId_facilityId: {
						userId: input.userId,
						facilityId: input.facilityId,
					},
				},
				data: { role: input.newRole },
			});

			// Sync User.userType if this is the target user's active facility + club
			const targetUser = await ctx.db.user.findUnique({
				where: { userId: input.userId },
				select: { activeFacilityId: true, clubShortName: true },
			});

			if (
				targetUser &&
				targetUser.activeFacilityId === input.facilityId &&
				targetUser.clubShortName === ctx.user.clubShortName
			) {
				await ctx.db.user.update({
					where: { userId: input.userId },
					data: { userType: input.newRole },
				});
			}

			return { success: true };
		}),

	// Update another user's profile (name only — email sync with Clerk deferred).
	// Access: caller must outrank the target's role at any facility in the caller's club.
	updateUserProfile: facilityProcedure
		.input(
			z.object({
				userId: z.string(),
				firstName: z.string().min(1).max(100).trim().optional(),
				lastName: z.string().min(1).max(100).trim().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Find the target's highest role within the caller's club
			const targetMemberships = await ctx.db.userClub.findMany({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { role: true },
			});

			if (targetMemberships.length === 0 && !isPlatformAdmin(ctx.user)) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found in your club.",
				});
			}

			// Check caller outranks the target's highest role in this club
			const highestRole = targetMemberships.reduce(
				(max, m) => Math.max(max, ROLE_HIERARCHY[m.role] ?? 0),
				0,
			);
			const callerLevel = ROLE_HIERARCHY[ctx.user.userType] ?? 0;

			if (!isPlatformAdmin(ctx.user) && callerLevel <= highestRole) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot modify a user with an equal or higher role.",
				});
			}

			return ctx.db.user.update({
				where: { userId: input.userId },
				data: {
					...(input.firstName !== undefined && { firstName: input.firstName }),
					...(input.lastName !== undefined && { lastName: input.lastName }),
				},
				select: { userId: true, firstName: true, lastName: true, email: true },
			});
		}),

	// Add an existing user to a facility.
	addUserToFacility: facilityProcedure
		.input(
			z.object({
				userId: z.string(),
				facilityId: z.string(),
				role: z.nativeEnum(UserType),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// canAssignRole is the correct gate: it validates the caller can grant this
			// role level. We intentionally don't check canManageUser against the target's
			// global userType — a user can hold different roles at different clubs/facilities
			// (e.g. CLUB_ADMIN at Club A, STUDENT at Club B).
			if (!canAssignRole(ctx.user.userType, input.role)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot assign this role.",
				});
			}

			// Validate facility in caller's club
			const facility = await ctx.db.clubFacility.findUnique({
				where: { facilityId: input.facilityId },
				select: { clubShortName: true },
			});

			if (!facility || facility.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Facility does not belong to your club.",
				});
			}

			// Check for existing membership — role changes go through updateUserRole
			const existing = await ctx.db.userClub.findUnique({
				where: {
					userId_facilityId: {
						userId: input.userId,
						facilityId: input.facilityId,
					},
				},
			});

			if (existing) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "User is already a member of this facility.",
				});
			}

			return ctx.db.userClub.create({
				data: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
					facilityId: input.facilityId,
					role: input.role,
				},
			});
		}),

	// Remove a user from a facility. Only STUDENT and COACH can be removed.
	removeUserFromFacility: facilityProcedure
		.input(
			z.object({
				userId: z.string(),
				facilityId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const membership = await ctx.db.userClub.findUnique({
				where: {
					userId_facilityId: {
						userId: input.userId,
						facilityId: input.facilityId,
					},
				},
				select: { id: true, clubShortName: true, role: true },
			});

			if (!membership || membership.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Membership not found in your club.",
				});
			}

			// Only STUDENT and COACH can be removed; any caller with facilityProcedure
			// access (FACILITY+) outranks them, so no separate canManageUser check needed.
			if (
				(ROLE_HIERARCHY[membership.role] ?? 0) > (ROLE_HIERARCHY.COACH ?? 0)
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only students and coaches can be removed from a facility.",
				});
			}

			await ctx.db.userClub.delete({
				where: {
					userId_facilityId: {
						userId: input.userId,
						facilityId: input.facilityId,
					},
				},
			});

			// If this was the user's active facility, switch to another in the same club
			const targetUser = await ctx.db.user.findUnique({
				where: { userId: input.userId },
				select: { activeFacilityId: true },
			});

			if (targetUser?.activeFacilityId === input.facilityId) {
				const nextMembership = await ctx.db.userClub.findFirst({
					where: {
						userId: input.userId,
						clubShortName: membership.clubShortName,
					},
					orderBy: { facility: { position: "asc" } },
					select: { facilityId: true, role: true },
				});

				await ctx.db.user.update({
					where: { userId: input.userId },
					data: {
						activeFacilityId: nextMembership?.facilityId ?? null,
						...(nextMembership ? { userType: nextMembership.role } : {}),
					},
				});
			}

			return { success: true };
		}),

	// ============================================================
	// USER TAGS (Phase 4)
	// ============================================================

	// List all tags for the caller's club, ordered alphabetically.
	listClubTags: facilityProcedure.query(async ({ ctx }) => {
		return ctx.db.tag.findMany({
			where: { clubShortName: ctx.user.clubShortName },
			orderBy: { name: "asc" },
			include: { _count: { select: { userTags: true } } },
		});
	}),

	// Create a new tag for the caller's club.
	createTag: facilityProcedure
		.input(
			z.object({
				name: z.string().min(1).max(50),
				bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
				textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clubShortName = ctx.user.clubShortName;

			return ctx.db.$transaction(async (tx) => {
				const tagCount = await tx.tag.count({ where: { clubShortName } });
				if (tagCount >= 100) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Maximum of 100 tags per club reached.",
					});
				}

				try {
					return await tx.tag.create({
						data: {
							clubShortName,
							name: input.name.toLowerCase().trim(),
							bgColor: input.bgColor,
							textColor: input.textColor,
						},
					});
				} catch (error) {
					if (
						error instanceof Prisma.PrismaClientKnownRequestError &&
						error.code === "P2002"
					) {
						throw new TRPCError({
							code: "CONFLICT",
							message: "A tag with this name already exists.",
						});
					}
					throw error;
				}
			});
		}),

	// Update an existing tag (admin only).
	updateTag: clubAdminProcedure
		.input(
			z.object({
				tagId: z.string(),
				name: z.string().min(1).max(50).optional(),
				bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
				textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tag = await ctx.db.tag.findUnique({
				where: { tagId: input.tagId },
			});
			if (!tag || tag.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Tag not found in your club.",
				});
			}

			const data: Record<string, string> = {};
			if (input.name !== undefined) data.name = input.name.toLowerCase().trim();
			if (input.bgColor !== undefined) data.bgColor = input.bgColor;
			if (input.textColor !== undefined) data.textColor = input.textColor;

			try {
				return await ctx.db.tag.update({
					where: { tagId: input.tagId },
					data,
				});
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A tag with this name already exists.",
					});
				}
				throw error;
			}
		}),

	// Delete a tag (admin only). UserTag rows cascade automatically.
	deleteTag: clubAdminProcedure
		.input(z.object({ tagId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const tag = await ctx.db.tag.findUnique({
				where: { tagId: input.tagId },
			});
			if (!tag || tag.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Tag not found in your club.",
				});
			}

			await ctx.db.tag.delete({ where: { tagId: input.tagId } });
		}),

	// Replace all tags on a user (set exact tag list).
	setUserTags: facilityProcedure
		.input(
			z.object({
				userId: z.string(),
				tagIds: z.array(z.string()).max(15),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clubShortName = ctx.user.clubShortName;

			// Validate target user belongs to caller's club and use highest role
			const targetMemberships = await ctx.db.userClub.findMany({
				where: { userId: input.userId, clubShortName },
				select: { role: true },
			});
			if (targetMemberships.length === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User is not a member of this club.",
				});
			}
			const highestRole = targetMemberships.reduce(
				(max, m) =>
					(ROLE_HIERARCHY[m.role as keyof typeof ROLE_HIERARCHY] ?? 0) >
					(ROLE_HIERARCHY[max as keyof typeof ROLE_HIERARCHY] ?? 0)
						? m.role
						: max,
				targetMemberships[0]!.role,
			);
			if (!canManageUser(ctx.user.userType, highestRole)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"You do not have permission to manage this user's tags.",
				});
			}

			await ctx.db.$transaction(async (tx) => {
				// Validate all tagIds belong to caller's club inside transaction
				if (input.tagIds.length > 0) {
					const validTags = await tx.tag.count({
						where: { tagId: { in: input.tagIds }, clubShortName },
					});
					if (validTags !== input.tagIds.length) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "One or more tags do not belong to your club.",
						});
					}
				}

				await tx.userTag.deleteMany({
					where: {
						userId: input.userId,
						tag: { clubShortName },
					},
				});
				if (input.tagIds.length > 0) {
					await tx.userTag.createMany({
						data: input.tagIds.map((tagId) => ({
							userId: input.userId,
							tagId,
						})),
					});
				}
			});
		}),

	// Bulk-add a single tag to multiple users.
	bulkAddTag: facilityProcedure
		.input(
			z.object({
				userIds: z.array(z.string()).min(1).max(500),
				tagId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clubShortName = ctx.user.clubShortName;

			// Validate tag belongs to caller's club
			const tag = await ctx.db.tag.findUnique({
				where: { tagId: input.tagId },
			});
			if (!tag || tag.clubShortName !== clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Tag not found in your club.",
				});
			}

			// Validate ALL users belong to caller's club and caller can manage each
			const targetUsers = await ctx.db.user.findMany({
				where: { userId: { in: input.userIds } },
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					clubMemberships: {
						where: { clubShortName },
						select: { role: true },
					},
				},
			});

			for (const target of targetUsers) {
				if (target.clubMemberships.length === 0) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `User ${target.firstName ?? ""} ${target.lastName ?? ""} is not in your club.`.trim(),
					});
				}
				const highestRole = target.clubMemberships.reduce(
					(max, m) =>
						(ROLE_HIERARCHY[m.role as keyof typeof ROLE_HIERARCHY] ?? 0) >
						(ROLE_HIERARCHY[max as keyof typeof ROLE_HIERARCHY] ?? 0)
							? m.role
							: max,
					target.clubMemberships[0]!.role,
				);
				if (!canManageUser(ctx.user.userType, highestRole)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: `Cannot manage user ${target.firstName ?? ""} ${target.lastName ?? ""}`.trim(),
					});
				}
			}

			// Also reject if any userId wasn't found at all
			if (targetUsers.length !== input.userIds.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "One or more users were not found.",
				});
			}

			return ctx.db.$transaction(async (tx) => {
				const existingAssignments = await tx.userTag.findMany({
					where: {
						userId: { in: input.userIds },
						tagId: input.tagId,
					},
					select: { userId: true },
				});
				const alreadyHasTag = new Set(
					existingAssignments.map((a) => a.userId),
				);

				const tagCounts = await tx.userTag.groupBy({
					by: ["userId"],
					where: { userId: { in: input.userIds } },
					_count: { id: true },
				});
				const tagCountMap = new Map(
					tagCounts.map((tc) => [tc.userId, tc._count.id]),
				);

				const toCreate: { userId: string; tagId: string }[] = [];
				let skipped = 0;

				for (const userId of input.userIds) {
					if (alreadyHasTag.has(userId)) {
						continue;
					}
					const currentCount = tagCountMap.get(userId) ?? 0;
					if (currentCount >= 15) {
						skipped++;
						continue;
					}
					toCreate.push({ userId, tagId: input.tagId });
				}

				if (toCreate.length > 0) {
					await tx.userTag.createMany({ data: toCreate });
				}

				return { added: toCreate.length, skipped };
			});
		}),

	// Returns all facility memberships for the user's current club.
	// Used by the calendar facility switcher dropdown.
	getFacilityMemberships: protectedProcedure.query(async ({ ctx }) => {
		const user = await getCurrentUser(ctx);

		const memberships = await ctx.db.userClub.findMany({
			where: {
				userId: user.userId,
				clubShortName: user.clubShortName,
				facility: { isActive: true },
			},
			include: {
				facility: {
					select: {
						facilityId: true,
						name: true,
						city: true,
						state: true,
						position: true,
					},
				},
			},
			orderBy: { facility: { position: "asc" } },
		});

		if (memberships.length > 0) {
			return memberships.map((m) => ({
				facilityId: m.facility.facilityId,
				facilityName: m.facility.name,
				location:
					[m.facility.city, m.facility.state].filter(Boolean).join(", ") || null,
				role: m.role,
				isActive: m.facilityId === user.activeFacilityId,
			}));
		}

		// Platform admins may have switched to a club with no UserClub rows.
		// Fall back to all active facilities in the club so the sidebar switcher works.
		if (!isPlatformAdmin(user)) return [];

		const facilities = await ctx.db.clubFacility.findMany({
			where: { clubShortName: user.clubShortName, isActive: true },
			orderBy: { position: "asc" },
			select: { facilityId: true, name: true, city: true, state: true, position: true },
		});

		return facilities.map((f) => ({
			facilityId: f.facilityId,
			facilityName: f.name,
			location: [f.city, f.state].filter(Boolean).join(", ") || null,
			role: UserType.PLATFORM_ADMIN,
			isActive: f.facilityId === user.activeFacilityId,
		}));
	}),
});
