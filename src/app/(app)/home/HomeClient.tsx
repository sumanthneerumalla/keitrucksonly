"use client";

import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/nextjs";
import { TodayEventsCard } from "~/app/(app)/home/TodayEventsCard";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

export default function HomeClient() {
	// Fetch user profile
	const { data: user, isLoading } = api.user.getOrCreateProfile.useQuery();

	return (
		<>
			<SignedOut>
				<RedirectToSignIn />
			</SignedOut>
			<SignedIn>
				<div className="container mx-auto px-4 py-8">
					<div className="mx-auto max-w-5xl">
						{isLoading ? (
							<div className="animate-pulse-slow">
								<div className="mb-6 h-8 w-1/3 rounded bg-gray-200"></div>
								<div className="mb-6 h-64 rounded bg-gray-100"></div>
							</div>
						) : user ? (
							<div className="animate-slide-up">
								<h1 className="mb-6 font-bold text-3xl">
									Welcome, {user.firstName || "Player"}!
								</h1>

								{user.userType === "STUDENT" && (
									<div className="mb-6">
										<TodayEventsCard />
									</div>
								)}

								<div className="glass-card rounded-lg p-6">
									<h2 className="mb-4 font-semibold text-xl">Your Dashboard</h2>
									<p className="mb-4 text-gray-600">
										This is your personal dashboard where you can access all
										your content and settings.
									</p>

									{/* Content based on user type */}
									{user.userType === "STUDENT" && (
										<div className="mt-4">
											<h3 className="mb-2 font-medium text-lg">
												Your Learning Journey
											</h3>
											<p className="text-gray-600">
												Use the navigation menu to access your video libraries
												and other resources.
											</p>
										</div>
									)}

									{user.userType === "COACH" && (
										<div className="mt-4">
											<h3 className="mb-2 font-medium text-lg">
												Coach Dashboard
											</h3>
											<p className="text-gray-600">
												Welcome to your coaching dashboard. More features coming
												soon!
											</p>
										</div>
									)}

									{user.userType === "FACILITY" && (
										<div className="mt-4">
											<h3 className="mb-2 font-medium text-lg">
												Facility Dashboard
											</h3>
											<p className="text-gray-600">
												Welcome to your facility dashboard. More features coming
												soon!
											</p>
										</div>
									)}

									{isAnyAdmin(user) && (
										<div className="mt-4">
											<h3 className="mb-2 font-medium text-lg">
												Admin Dashboard
											</h3>
											<p className="text-gray-600">
												Welcome to the admin dashboard. Use the navigation menu
												to access all platform features.
											</p>
										</div>
									)}
								</div>
							</div>
						) : (
							<div className="py-8 text-center">
								<p>Unable to load user profile. Please try again later.</p>
							</div>
						)}
					</div>
				</div>
			</SignedIn>
		</>
	);
}
