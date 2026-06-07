"use client";

import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/nextjs";
import { Gender } from "@prisma/client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import CoachProfile from "~/app/_components/client/CoachProfile";
import StudentProfile from "~/app/_components/client/StudentProfile";
import AdminClubIdSelector from "~/app/_components/client/authed/AdminClubIdSelector";
import { ErrorBanner } from "~/app/_components/shared/ErrorBanner";
import { Select } from "~/app/_components/shared/ui/select";
import { TIMEZONE_OPTIONS } from "~/lib/timezones";
import { isAnyAdmin, isOnboardedUser } from "~/lib/utils";
import { parseServerError } from "~/lib/validation";
import { api } from "~/trpc/react";

export default function ProfilePage() {
	return (
		<Suspense
			fallback={<div className="py-8 text-center">Loading profile...</div>}
		>
			<ProfilePageContent />
		</Suspense>
	);
}

function ProfilePageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isEditing, setIsEditing] = useState(false);
	const clubAssignmentAttempted = useRef(false);

	// Fetch or create user profile
	const {
		data: user,
		isLoading,
		refetch,
	} = api.user.getOrCreateProfile.useQuery();

	// Mutations
	const updateProfile = api.user.updateProfile.useMutation({
		onSuccess: () => {
			setIsEditing(false);
			setServerError("");
			void refetch();
		},
		onError: (error) => {
			// Parse server-side validation errors
			const parsedErrors = parseServerError(error.message);

			// Set general error if any
			if (parsedErrors.general) {
				setServerError(parsedErrors.general);
			}
		},
	});

	// joinClub mutation — used when a new user arrives from a club landing
	// page with ?joinClub=... URL param. Keeps activeFacilityId in sync.
	const joinClubMutation = api.user.joinClub.useMutation({
		onSuccess: () => {
			void refetch();
		},
	});

	// Form state (clubName is derived from backend, not editable directly)
	const [formData, setFormData] = useState({
		firstName: "",
		lastName: "",
		email: "",
		timeZone: "",
		clubName: "",
	});

	const [serverError, setServerError] = useState<string>("");

	// Gender is set-once (B1): editable only until the user has a value.
	const [genderInput, setGenderInput] = useState<Gender | "">("");
	const genderLocked = !!user?.gender;

	const isFirstNameMissing = formData.firstName.trim().length === 0;
	const isLastNameMissing = formData.lastName.trim().length === 0;
	const isEmailMissing = formData.email.trim().length === 0;
	const isGenderMissing = !genderLocked && !genderInput;
	const isMissingRequiredFields =
		isFirstNameMissing ||
		isLastNameMissing ||
		isEmailMissing ||
		isGenderMissing;

	// Initialize form when user data loads and handle joinClub URL parameter
	useEffect(() => {
		if (!user) return;

		// Initialize form with user data (clubName derived from backend)
		setFormData({
			firstName: user.firstName || "",
			lastName: user.lastName || "",
			email: user.email || "",
			timeZone: user.timeZone || "",
			clubName: user.clubName || "",
		});
		setServerError("");
		setGenderInput("");

		// Handle automatic club assignment from URL parameter.
		// This param is set by Clerk's forceRedirectUrl when users sign up/in
		// from a club landing page (/club/{clubShortName}).
		// See: /club/[clubShortName]/page.tsx for the flow documentation.
		// Uses joinClub mutation (not updateProfile) so activeFacilityId stays
		// in sync with the new club's first facility.
		const joinClub = searchParams.get("joinClub");
		if (
			joinClub &&
			!clubAssignmentAttempted.current &&
			user.clubShortName === "shuttlementor"
		) {
			clubAssignmentAttempted.current = true;
			joinClubMutation.mutate(
				{ clubShortName: joinClub },
				{
					onSuccess: () => {
						// Remove joinClub param from URL after successful assignment (if present)
						if (searchParams.get("joinClub")) {
							router.replace("/profile");
						}
					},
				},
			);
		}
	}, [user, searchParams]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setServerError("");

		// Store current form data in case we need to restore it on error
		const currentFormData = { ...formData };
		updateProfile.mutate(
			{ ...formData, gender: genderInput || undefined },
			{
				onError: () => {
					// Preserve form data on error so user doesn't lose their changes
					setFormData(currentFormData);
				},
			},
		);
	};

	const handleCancel = () => {
		setIsEditing(false);
		setServerError("");
		if (user) {
			setFormData({
				firstName: user.firstName || "",
				lastName: user.lastName || "",
				email: user.email || "",
				timeZone: user.timeZone || "",
				clubName: user.clubName || "",
			});
			setGenderInput("");
		}
	};

	return (
		<>
			<SignedOut>
				<RedirectToSignIn />
			</SignedOut>
			<SignedIn>
				<div className="container mx-auto px-4 py-8">
					<div className="mx-auto max-w-2xl">
						<h1 className="mb-2 font-bold text-3xl">My Profile</h1>
						{user && !isOnboardedUser(user) && (
							<ErrorBanner
								message="First name, last name, email, and gender are required to complete onboarding."
								className="mb-8"
							/>
						)}

						{isLoading ? (
							<div className="py-8 text-center">Loading profile...</div>
						) : user ? (
							<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
								<div className="mb-4 border-gray-100 border-b pb-4">
									<p className="select-text text-gray-400 text-xs">
										User ID:{" "}
										<span className="cursor-text select-all font-mono">
											{user.userId}
										</span>
									</p>
								</div>

								{!isEditing ? (
									/* ── View mode ── */
									<div className="space-y-4">
										<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
											<div className="flex-1 space-y-4">
												<div>
													<label
														htmlFor="profile-view-first-name"
														className="text-gray-500 text-sm"
													>
														First Name
													</label>
													<p
														id="profile-view-first-name"
														className="font-medium text-lg"
													>
														{user.firstName ?? (
															<span className="text-red-600">Not set</span>
														)}
													</p>
												</div>

												<div>
													<label
														htmlFor="profile-view-last-name"
														className="text-gray-500 text-sm"
													>
														Last Name
													</label>
													<p
														id="profile-view-last-name"
														className="font-medium text-lg"
													>
														{user.lastName ?? (
															<span className="text-red-600">Not set</span>
														)}
													</p>
												</div>

												<div>
													<label
														htmlFor="profile-view-email"
														className="text-gray-500 text-sm"
													>
														Email
													</label>
													<p id="profile-view-email" className="text-lg">
														{user.email ?? (
															<span className="text-red-600">Not set</span>
														)}
													</p>
												</div>

												<div>
													<label
														htmlFor="profile-view-time-zone"
														className="text-gray-500 text-sm"
													>
														Time Zone
													</label>
													<p id="profile-view-time-zone" className="text-lg">
														{user.timeZone ?? (
															<span className="text-red-600">Not set</span>
														)}
													</p>
												</div>

												<div>
													<label
														htmlFor="profile-view-club"
														className="text-gray-500 text-sm"
													>
														Club
													</label>
													<p id="profile-view-club" className="text-lg">
														{user.clubName ?? (
															<span className="text-red-600">Not set</span>
														)}
													</p>
													<AdminClubIdSelector
														mode="switch"
														scope={isAnyAdmin(user) ? "all" : "memberships"}
														className="mt-3"
														onSwitch={() => {
															void refetch();
															router.refresh();
														}}
													/>
												</div>

												<div>
													<label
														htmlFor="profile-view-account-type"
														className="text-gray-500 text-sm"
													>
														Account Type
													</label>
													<p
														id="profile-view-account-type"
														className="text-lg capitalize"
													>
														{user.userType.toLowerCase()}
													</p>
												</div>

												<div>
													<label
														htmlFor="profile-view-member-since"
														className="text-gray-500 text-sm"
													>
														Member Since
													</label>
													<p id="profile-view-member-since" className="text-lg">
														{new Date(user.createdAt).toLocaleDateString()}
													</p>
												</div>
											</div>

											<button
												onClick={() => {
													setFormData({
														firstName: user.firstName || "",
														lastName: user.lastName || "",
														email: user.email || "",
														timeZone: user.timeZone || "",
														clubName: user.clubName || "",
													});
													setIsEditing(true);
												}}
												className="self-start rounded-lg bg-[var(--primary)] px-4 py-2 text-white transition-colors hover:bg-[var(--primary-dark)] sm:self-auto"
											>
												Edit Profile
											</button>
										</div>
									</div>
								) : (
									/* ── Edit mode ── */
									<form onSubmit={handleSubmit} className="space-y-4">
										{/* Display server error if any */}
										<ErrorBanner message={serverError} />

										{updateProfile.isSuccess && !isEditing && (
											<div className="rounded-lg border border-green-200 bg-green-50 p-3">
												<p className="text-green-600 text-sm">
													Profile updated successfully!
												</p>
											</div>
										)}

										<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
											<div>
												<label
													htmlFor="profile-edit-first-name"
													className="mb-1 block font-medium text-gray-700 text-sm"
												>
													First Name
												</label>
												<input
													id="profile-edit-first-name"
													type="text"
													value={formData.firstName}
													onChange={(e) =>
														setFormData({
															...formData,
															firstName: e.target.value,
														})
													}
													className={`required-field-input w-full rounded-lg px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${isFirstNameMissing ? "required-field-input--error" : ""}`}
													placeholder="Enter first name"
												/>
												{isFirstNameMissing && (
													<p className="required-field-message">
														First name is required.
													</p>
												)}
											</div>

											<div>
												<label
													htmlFor="profile-edit-last-name"
													className="mb-1 block font-medium text-gray-700 text-sm"
												>
													Last Name
												</label>
												<input
													id="profile-edit-last-name"
													type="text"
													value={formData.lastName}
													onChange={(e) =>
														setFormData({
															...formData,
															lastName: e.target.value,
														})
													}
													className={`required-field-input w-full rounded-lg px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${isLastNameMissing ? "required-field-input--error" : ""}`}
													placeholder="Enter last name"
												/>
												{isLastNameMissing && (
													<p className="required-field-message">
														Last name is required.
													</p>
												)}
											</div>
										</div>

										<div>
											<label
												htmlFor="profile-edit-email"
												className="mb-1 block font-medium text-gray-700 text-sm"
											>
												Email
											</label>
											<input
												id="profile-edit-email"
												type="email"
												value={formData.email}
												onChange={(e) =>
													setFormData({ ...formData, email: e.target.value })
												}
												className={`required-field-input w-full rounded-lg px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${isEmailMissing ? "required-field-input--error" : ""}`}
												placeholder="Enter email"
											/>
											{isEmailMissing && (
												<p className="required-field-message">
													Email is required.
												</p>
											)}
										</div>

										<div>
											<label
												htmlFor="profile-edit-gender"
												className="mb-1 block font-medium text-gray-700 text-sm"
											>
												Gender
											</label>
											{genderLocked ? (
												<div className="rounded-lg bg-gray-50 px-3 py-2 text-gray-700">
													{user.gender === Gender.MALE ? "Male" : "Female"}
													<span className="ml-2 text-gray-400 text-xs">
														(can't be changed)
													</span>
												</div>
											) : (
												<>
													<Select
														id="profile-edit-gender"
														value={genderInput}
														onChange={(e) =>
															setGenderInput(e.target.value as Gender | "")
														}
													>
														<option value="">Select gender</option>
														<option value={Gender.MALE}>Male</option>
														<option value={Gender.FEMALE}>Female</option>
													</Select>
													{isGenderMissing && (
														<p className="required-field-message">
															Gender is required.
														</p>
													)}
												</>
											)}
										</div>

										<div>
											<label
												htmlFor="profile-edit-time-zone"
												className="mb-1 block font-medium text-gray-700 text-sm"
											>
												Time Zone
											</label>
											<Select
												id="profile-edit-time-zone"
												value={formData.timeZone}
												onChange={(e) =>
													setFormData({ ...formData, timeZone: e.target.value })
												}
											>
												<option value="">Select time zone</option>
												{TIMEZONE_OPTIONS.map((tz) => (
													<option key={tz.value} value={tz.value}>
														{tz.label}
													</option>
												))}
											</Select>
										</div>

										{/* Club switcher — uses switchClub mutation which keeps
										    activeFacilityId in sync. Both admins and non-admins see
										    the same switch-mode selector. To add yourself to a new
										    club, use /join instead. */}
										<AdminClubIdSelector
											mode="switch"
											scope={isAnyAdmin(user) ? "all" : "memberships"}
											onSwitch={() => {
												void refetch();
												router.refresh();
												setIsEditing(false);
											}}
										/>

										<div className="flex gap-3 pt-2">
											<button
												type="submit"
												disabled={
													updateProfile.isPending || isMissingRequiredFields
												}
												className="rounded-lg bg-[var(--primary)] px-4 py-2 text-white transition-colors hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
											>
												{updateProfile.isPending ? "Saving..." : "Save Changes"}
											</button>
											<button
												type="button"
												onClick={handleCancel}
												className="rounded-lg border border-gray-300 px-4 py-2 transition-colors hover:bg-gray-50"
											>
												Cancel
											</button>
										</div>
									</form>
								)}
							</div>
						) : (
							<div className="py-8 text-center">No profile found</div>
						)}

						{/* Student Profile Section */}
						{user?.studentProfile && user.userType === "STUDENT" && (
							<div className="mt-6">
								<StudentProfile
									initialProfile={user.studentProfile}
									userId={user.userId}
									firstName={user.firstName}
									lastName={user.lastName}
									clubName={user.clubName}
								/>
							</div>
						)}

						{/* Coach Profile Section */}
						{user?.coachProfile && user.userType === "COACH" && (
							<div className="mt-6">
								<CoachProfile
									initialProfile={user.coachProfile}
									userId={user.userId}
									firstName={user.firstName}
									lastName={user.lastName}
									clubName={user.clubName}
								/>
							</div>
						)}

						{/* Admin can see both profiles */}
						{user && isAnyAdmin(user) && (
							<>
								{user.studentProfile && (
									<div className="mt-6">
										<StudentProfile
											initialProfile={user.studentProfile}
											userId={user.userId}
											firstName={user.firstName}
											lastName={user.lastName}
											clubName={user.clubName}
										/>
									</div>
								)}
								{user.coachProfile && (
									<div className="mt-6">
										<CoachProfile
											initialProfile={user.coachProfile}
											userId={user.userId}
											firstName={user.firstName}
											lastName={user.lastName}
											clubName={user.clubName}
										/>
									</div>
								)}
							</>
						)}
					</div>
				</div>
			</SignedIn>
		</>
	);
}
