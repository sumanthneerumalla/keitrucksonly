"use client";

import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/nextjs";
import { Suspense } from "react";
import { CoachesListing } from "~/app/_components/coaches/CoachesListing";

export default function CoachesPage() {
	return (
		<>
			<SignedOut>
				<RedirectToSignIn />
			</SignedOut>
			<SignedIn>
				<div className="container mx-auto px-4 py-8">
					<div className="mx-auto max-w-7xl">
						<h1 className="mb-6 font-bold text-3xl">Find a Coach</h1>
						<div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
							<div className="lg:col-span-1">
								{/* Filters will go here */}
								<div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
									<h2 className="mb-4 font-semibold text-lg">Filters</h2>
									<p className="text-gray-500 text-sm">
										Filter components coming soon
									</p>
								</div>
							</div>
							<div className="lg:col-span-3">
								<Suspense fallback={null}>
									<CoachesListing />
								</Suspense>
							</div>
						</div>
					</div>
				</div>
			</SignedIn>
		</>
	);
}
