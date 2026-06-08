import ResourceVideoCard from "~/app/_components/shared/ResourceVideoCard";

export default function GettingStartedPage() {
	return (
		<div className="container mx-auto px-4 py-4 md:py-8">
			<div className="mx-auto max-w-4xl">
				<div className="mb-12 text-center">
					<h1 className="section-heading animate-slide-up">Getting Started</h1>
					<p
						className="section-subheading mx-auto animate-slide-up"
						style={{ animationDelay: "0.1s" }}
					>
						Learn how to get the most out of Facility Presence with these
						helpful video guides.
					</p>
				</div>

				{/* Quick Links */}
				<div className="mb-12">
					<h2 className="mb-4 font-semibold text-lg">Quick Links:</h2>
					<ul className="space-y-2">
						<li>
							<a
								href="#signing-up"
								className="text-[var(--primary)] hover:underline"
							>
								• Signing Up
							</a>
						</li>
						<li>
							<a
								href="#uploading-videos"
								className="text-[var(--primary)] hover:underline"
							>
								• Uploading Your Videos
							</a>
						</li>
						<li>
							<a
								href="#requesting-feedback"
								className="text-[var(--primary)] hover:underline"
							>
								• Requesting Feedback From Coaches
							</a>
						</li>
					</ul>
				</div>

				<div className="space-y-8">
					<div id="signing-up">
						<ResourceVideoCard
							title="Signing Up"
							videoUrl="https://www.youtube.com/watch?v=KPkjwZ7ghzU"
							description="For new users that dont have accounts, or haven't onboarded yet"
						/>
					</div>

					<div id="uploading-videos">
						<ResourceVideoCard
							title="Uploading Your Videos"
							videoUrl="https://www.youtube.com/watch?v=zRUO7tpKMas"
							description="How to upload your own videos to your account."
						/>
					</div>

					<div id="requesting-feedback">
						<ResourceVideoCard
							title="Requesting Feedback From Coaches"
							videoUrl="https://www.youtube.com/watch?v=N35Gn9p8vpQ"
							description="You can assign your uploaded videos to the coaches of your choice to get feedback from them"
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
