"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import MemberPackagesCard from "~/app/(app)/admin/checkin/MemberPackagesCard";
import { Button } from "~/app/_components/shared/Button";
import { api } from "~/trpc/react";
import AttendanceHistoryCard from "./AttendanceHistoryCard";
import BillingPanel from "./BillingPanel";
import FamilyCard from "./FamilyCard";
import MemberMembershipsCard from "./MemberMembershipsCard";
import ProfileFieldsCard from "./ProfileFieldsCard";
import StudentSignupsCard from "./StudentSignupsCard";

interface StudentDetailClientProps {
	userId: string;
	viewerIsAdmin?: boolean;
}

export default function StudentDetailClient({
	userId,
	viewerIsAdmin = false,
}: StudentDetailClientProps) {
	const { data, isLoading, error } = api.user.getStudentDetail.useQuery(
		{ userId },
		{ enabled: !!userId },
	);

	if (isLoading) {
		return (
			<div className="mx-auto max-w-4xl space-y-6 p-6">
				<div className="h-10 w-32 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-24 animate-pulse rounded-lg bg-[var(--muted)]" />
				<div className="h-64 animate-pulse rounded-lg bg-[var(--muted)]" />
				<div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />
				<div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-3 p-12 text-center">
				<p className="text-[var(--foreground)] text-sm">
					{error?.message ?? "Student not found."}
				</p>
				<Link href="/clients">
					<Button variant="outline" size="sm">
						<ArrowLeft size={14} />
						Back to clients
					</Button>
				</Link>
			</div>
		);
	}

	const { user, studentProfile, profileData, tags } = data;
	const fullName =
		`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Unnamed";
	const firstLetter = (user.firstName ?? user.lastName ?? "?")
		.trim()
		.charAt(0)
		.toUpperCase();
	const profileImage = studentProfile?.profileImage ?? null;
	// DOB is global (User.dateOfBirth); format to YYYY-MM-DD for the date input.
	const dateOfBirth = user.dateOfBirth
		? new Date(user.dateOfBirth).toISOString().slice(0, 10)
		: null;

	return (
		<div className="mx-auto max-w-4xl space-y-6 p-6">
			{/* Back link */}
			<div>
				<Link href="/clients">
					<Button variant="default" size="lg" className="[&_svg]:size-5">
						<ArrowLeft />
						Back to clients
					</Button>
				</Link>
			</div>

			{/* Header */}
			<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
				<div className="flex items-center gap-4">
					{profileImage ? (
						// biome-ignore lint/a11y/useAltText: data URL avatar, alt provided
						<img
							src={profileImage}
							alt={fullName}
							className="h-16 w-16 rounded-full object-cover"
						/>
					) : (
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] font-semibold text-[var(--primary)] text-xl">
							{firstLetter}
						</div>
					)}
					<div className="min-w-0 flex-1">
						<h1 className="truncate font-semibold text-[var(--foreground)] text-xl">
							{fullName}
						</h1>
						{user.email && (
							<p className="truncate text-[var(--muted-foreground)] text-sm">
								{user.email}
							</p>
						)}
						{tags.length > 0 && (
							<div className="mt-2 flex flex-wrap gap-1">
								{tags.map((tag) => (
									<span
										key={tag.tagId}
										style={{
											backgroundColor: tag.bgColor,
											color: tag.textColor,
										}}
										className="inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs capitalize"
									>
										{tag.name}
									</span>
								))}
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Profile fields */}
			<ProfileFieldsCard
				userId={user.userId}
				email={user.email}
				dateOfBirth={dateOfBirth}
				profileData={profileData}
			/>

			{/* Family — public-shop v1 (decision #16) */}
			<FamilyCard userId={user.userId} memberName={fullName} />

			{/* Packages (reuses MemberPackagesCard — handles its own sell modal) */}
			<MemberPackagesCard userId={user.userId} memberName={fullName} />

			{/* Memberships — Phase 10a (WP6): list + status badges + actions; own sell modal */}
			<MemberMembershipsCard userId={user.userId} memberName={fullName} />

			{/* Active event sign-ups (event-level + series-level) */}
			<StudentSignupsCard userId={user.userId} />

			{/* Attendance history */}
			<AttendanceHistoryCard userId={user.userId} />

			{/* Billing — Phase 9-EOD (2026-05-02): read-only invoice list + 3 rollup tiles */}
			<BillingPanel userId={user.userId} viewerIsAdmin={viewerIsAdmin} />
		</div>
	);
}
