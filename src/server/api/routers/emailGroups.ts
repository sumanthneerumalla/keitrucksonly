// @ts-nocheck
// TODO: Remove @ts-nocheck after running `prisma generate` with the email groups migration applied.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	staffProcedure,
} from "~/server/api/trpc";
import { getCurrentUser, isAnyAdmin } from "~/server/utils/utils";

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const filterConfigSchema = z.object({
	tagIds: z.array(z.string()).default([]),
	ageMin: z.number().int().min(0).optional(),
	ageMax: z.number().int().min(0).optional(),
});

type FilterConfig = z.infer<typeof filterConfigSchema>;

// ─── Helper: compute age from DOB ──────────────────────────────────────────

function computeAge(dateOfBirth: Date): number {
	const today = new Date();
	let age = today.getFullYear() - dateOfBirth.getFullYear();
	const monthDiff = today.getMonth() - dateOfBirth.getMonth();
	if (
		monthDiff < 0 ||
		(monthDiff === 0 && today.getDate() < dateOfBirth.getDate())
	) {
		age--;
	}
	return age;
}

// ─── Helper: get users matching filters at a facility ──────────────────────

function getDateOfBirth(user: any): Date | null {
	// Prefer the promoted User.dateOfBirth column
	if (user.dateOfBirth) return new Date(user.dateOfBirth);

	// Fall back to StudentProfile.profileData JSON blob
	const profileData = user.studentProfile?.profileData;
	if (profileData && typeof profileData === "object" && profileData.dateOfBirth) {
		const parsed = new Date(profileData.dateOfBirth);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}

	return null;
}

async function getUsersMatchingFilters(
	db: any,
	facilityId: string,
	filterConfig: FilterConfig | null,
) {
	if (!filterConfig) return [];

	const { tagIds, ageMin, ageMax } = filterConfig;

	// Get all users at this facility via UserClub
	const facilityMemberships = await db.userClub.findMany({
		where: { facilityId },
		include: {
			user: {
				select: {
					userId: true,
					email: true,
					firstName: true,
					lastName: true,
					dateOfBirth: true,
					studentProfile: { select: { profileData: true } },
					userTags: { select: { tagId: true } },
				},
			},
		},
	});

	let users = facilityMemberships.map((m: any) => m.user);

	// Filter by tags (AND: user must have ALL specified tags)
	if (tagIds.length > 0) {
		users = users.filter((u) => {
			const userTagIds = u.userTags.map((ut: { tagId: string }) => ut.tagId);
			return tagIds.every((tid: string) => userTagIds.includes(tid));
		});
	}

	// Filter by age range
	if (ageMin !== undefined || ageMax !== undefined) {
		users = users.filter((u) => {
			const dob = getDateOfBirth(u);
			if (!dob) return false;
			const age = computeAge(dob);
			if (ageMin !== undefined && age < ageMin) return false;
			if (ageMax !== undefined && age > ageMax) return false;
			return true;
		});
	}

	return users;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const emailGroupsRouter = createTRPCRouter({
	// Create a new email group
	create: staffProcedure
		.input(
			z.object({
				facilityId: z.string(),
				name: z.string().min(1).max(200),
				filterConfig: filterConfigSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			// Verify user belongs to this facility
			const membership = await ctx.db.userClub.findUnique({
				where: { userId_facilityId: { userId: user.userId, facilityId: input.facilityId } },
			});
			if (!membership && !isAnyAdmin(user)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You do not belong to this facility",
				});
			}

			const group = await ctx.db.emailGroup.create({
				data: {
					clubShortName: user.clubShortName,
					facilityId: input.facilityId,
					name: input.name,
					createdByUserId: user.userId,
					filterConfig: input.filterConfig ?? null,
				},
			});

			// Sync initial members from filters
			if (input.filterConfig) {
				const matchedUsers = await getUsersMatchingFilters(
					ctx.db,
					input.facilityId,
					input.filterConfig,
				);
				if (matchedUsers.length > 0) {
					await ctx.db.emailGroupMember.createMany({
						data: matchedUsers.map((u) => ({
							emailGroupId: group.emailGroupId,
							userId: u.userId,
							source: "filter",
						})),
						skipDuplicates: true,
					});
				}
			}

			return group;
		}),

	// Update group name and/or filters
	update: staffProcedure
		.input(
			z.object({
				emailGroupId: z.string(),
				name: z.string().min(1).max(200).optional(),
				filterConfig: filterConfigSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const group = await ctx.db.emailGroup.findUnique({
				where: { emailGroupId: input.emailGroupId },
			});
			if (!group) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}

			// Only creator or admins can update
			if (group.createdByUserId !== user.userId && !isAnyAdmin(user)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Only the group admin can edit this group" });
			}

			const updated = await ctx.db.emailGroup.update({
				where: { emailGroupId: input.emailGroupId },
				data: {
					...(input.name && { name: input.name }),
					...(input.filterConfig && { filterConfig: input.filterConfig }),
				},
			});

			// Auto-sync members when filters change
			if (input.filterConfig) {
				const exclusions = await ctx.db.emailGroupExclusion.findMany({
					where: { emailGroupId: input.emailGroupId },
					select: { userId: true },
				});
				const excludedUserIds = new Set(exclusions.map((e) => e.userId));

				// Remove all existing filter-sourced members
				await ctx.db.emailGroupMember.deleteMany({
					where: { emailGroupId: input.emailGroupId, source: "filter" },
				});

				// Add new matched users
				const matchedUsers = await getUsersMatchingFilters(ctx.db, group.facilityId, input.filterConfig);
				const usersToAdd = matchedUsers.filter((u) => !excludedUserIds.has(u.userId));

				if (usersToAdd.length > 0) {
					await ctx.db.emailGroupMember.createMany({
						data: usersToAdd.map((u) => ({
							emailGroupId: input.emailGroupId,
							userId: u.userId,
							source: "filter",
						})),
						skipDuplicates: true,
					});
				}
			}

			return updated;
		}),

	// Delete a group
	delete: staffProcedure
		.input(z.object({ emailGroupId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const group = await ctx.db.emailGroup.findUnique({
				where: { emailGroupId: input.emailGroupId },
			});
			if (!group) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}

			if (group.createdByUserId !== user.userId && !isAnyAdmin(user)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Only the group admin can delete this group" });
			}

			await ctx.db.emailGroup.delete({ where: { emailGroupId: input.emailGroupId } });
			return { success: true };
		}),

	// Get groups the current user is a member of
	getMyGroups: staffProcedure.query(async ({ ctx }) => {
		const user = await getCurrentUser(ctx);

		const memberships = await ctx.db.emailGroupMember.findMany({
			where: { userId: user.userId },
			select: {
				emailGroup: {
					include: {
						_count: { select: { members: true } },
						createdByUser: { select: { firstName: true, lastName: true } },
						facility: { select: { name: true } },
					},
				},
			},
		});

		return memberships.map((m) => m.emailGroup);
	}),

	// Get all groups at a facility (platform/club admin only)
	getAllForFacility: staffProcedure
		.input(z.object({ facilityId: z.string() }))
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			if (!isAnyAdmin(user)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
			}

			return ctx.db.emailGroup.findMany({
				where: { facilityId: input.facilityId },
				include: {
					_count: { select: { members: true } },
					createdByUser: { select: { firstName: true, lastName: true } },
				},
				orderBy: { createdAt: "desc" },
			});
		}),

	// Get group detail with members
	getById: staffProcedure
		.input(z.object({ emailGroupId: z.string() }))
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			const group = await ctx.db.emailGroup.findUnique({
				where: { emailGroupId: input.emailGroupId },
				include: {
					members: {
						include: {
							user: {
								select: { userId: true, email: true, firstName: true, lastName: true, profileImage: true },
							},
						},
					},
					exclusions: {
						include: {
							user: { select: { userId: true, email: true, firstName: true, lastName: true } },
						},
					},
					createdByUser: { select: { userId: true, firstName: true, lastName: true } },
					facility: { select: { facilityId: true, name: true } },
					_count: { select: { sendLogs: true } },
				},
			});

			if (!group) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}

			// Check access: must be member or admin
			const isMember = group.members.some((m) => m.userId === user.userId);
			if (!isMember && !isAnyAdmin(user)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
			}

			return group;
		}),

	// Re-sync members from filters (fully replace filter-sourced members)
	syncMembers: staffProcedure
		.input(z.object({ emailGroupId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const group = await ctx.db.emailGroup.findUnique({
				where: { emailGroupId: input.emailGroupId },
				include: { exclusions: { select: { userId: true } } },
			});

			if (!group) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}
			if (group.createdByUserId !== user.userId && !isAnyAdmin(user.userType)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Only the group admin can sync members" });
			}

			const filterConfig = group.filterConfig as FilterConfig | null;
			const excludedUserIds = new Set(group.exclusions.map((e) => e.userId));

			// Remove all existing filter-sourced members
			await ctx.db.emailGroupMember.deleteMany({
				where: { emailGroupId: input.emailGroupId, source: "filter" },
			});

			if (!filterConfig) {
				return { added: 0, removed: 0 };
			}

			const matchedUsers = await getUsersMatchingFilters(ctx.db, group.facilityId, filterConfig);

			// Only add users who are not excluded
			const usersToAdd = matchedUsers.filter((u) => !excludedUserIds.has(u.userId));

			if (usersToAdd.length > 0) {
				await ctx.db.emailGroupMember.createMany({
					data: usersToAdd.map((u) => ({
						emailGroupId: input.emailGroupId,
						userId: u.userId,
						source: "filter",
					})),
					skipDuplicates: true,
				});
			}

			return { added: usersToAdd.length };
		}),

	// Manually add members
	addMembers: staffProcedure
		.input(
			z.object({
				emailGroupId: z.string(),
				userIds: z.array(z.string()).min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const group = await ctx.db.emailGroup.findUnique({
				where: { emailGroupId: input.emailGroupId },
			});
			if (!group) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}
			if (group.createdByUserId !== user.userId && !isAnyAdmin(user.userType)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Only the group admin can add members" });
			}

			// Remove any exclusions for these users (they're being re-added)
			await ctx.db.emailGroupExclusion.deleteMany({
				where: {
					emailGroupId: input.emailGroupId,
					userId: { in: input.userIds },
				},
			});

			await ctx.db.emailGroupMember.createMany({
				data: input.userIds.map((userId) => ({
					emailGroupId: input.emailGroupId,
					userId,
					source: "manual",
				})),
				skipDuplicates: true,
			});

			return { added: input.userIds.length };
		}),

	// Remove members (admin action)
	removeMembers: staffProcedure
		.input(
			z.object({
				emailGroupId: z.string(),
				userIds: z.array(z.string()).min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const group = await ctx.db.emailGroup.findUnique({
				where: { emailGroupId: input.emailGroupId },
			});
			if (!group) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}
			if (group.createdByUserId !== user.userId && !isAnyAdmin(user.userType)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Only the group admin can remove members" });
			}

			// Delete membership rows
			await ctx.db.emailGroupMember.deleteMany({
				where: {
					emailGroupId: input.emailGroupId,
					userId: { in: input.userIds },
				},
			});

			// Add exclusion records
			await ctx.db.emailGroupExclusion.createMany({
				data: input.userIds.map((userId) => ({
					emailGroupId: input.emailGroupId,
					userId,
					reason: "removed",
				})),
				skipDuplicates: true,
			});

			return { removed: input.userIds.length };
		}),

	// Leave a group (self-removal)
	leave: staffProcedure
		.input(z.object({ emailGroupId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			// Delete membership
			await ctx.db.emailGroupMember.deleteMany({
				where: { emailGroupId: input.emailGroupId, userId: user.userId },
			});

			// Add exclusion
			await ctx.db.emailGroupExclusion.upsert({
				where: {
					emailGroupId_userId: { emailGroupId: input.emailGroupId, userId: user.userId },
				},
				create: {
					emailGroupId: input.emailGroupId,
					userId: user.userId,
					reason: "left",
				},
				update: { reason: "left", excludedAt: new Date() },
			});

			return { success: true };
		}),

	// Rejoin a group (remove exclusion, re-add as member)
	rejoin: staffProcedure
		.input(z.object({ emailGroupId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			// Remove exclusion
			await ctx.db.emailGroupExclusion.deleteMany({
				where: { emailGroupId: input.emailGroupId, userId: user.userId },
			});

			// Add back as member
			await ctx.db.emailGroupMember.upsert({
				where: {
					emailGroupId_userId: { emailGroupId: input.emailGroupId, userId: user.userId },
				},
				create: {
					emailGroupId: input.emailGroupId,
					userId: user.userId,
					source: "manual",
				},
				update: { source: "manual", joinedAt: new Date() },
			});

			return { success: true };
		}),

	// Preview filter results (without saving)
	getFilterPreview: staffProcedure
		.input(
			z.object({
				facilityId: z.string(),
				filterConfig: filterConfigSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			const users = await getUsersMatchingFilters(ctx.db, input.facilityId, input.filterConfig);
			return {
				count: users.length,
				users: users.map((u) => ({
					userId: u.userId,
					email: u.email,
					firstName: u.firstName,
					lastName: u.lastName,
				})),
			};
		}),

	// Get send history for a group
	getSendHistory: staffProcedure
		.input(z.object({ emailGroupId: z.string() }))
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			// Verify membership or admin
			const membership = await ctx.db.emailGroupMember.findUnique({
				where: { emailGroupId_userId: { emailGroupId: input.emailGroupId, userId: user.userId } },
			});
			if (!membership && !isAnyAdmin(user.userType)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
			}

			return ctx.db.emailSendLog.findMany({
				where: { emailGroupId: input.emailGroupId },
				include: {
					sender: { select: { firstName: true, lastName: true, email: true } },
				},
				orderBy: { sentAt: "desc" },
				take: 50,
			});
		}),
});
