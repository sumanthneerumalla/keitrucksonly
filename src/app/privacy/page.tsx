export const metadata = {
	title: "Privacy Policy — Beacon LLC",
	description:
		"Privacy Policy for the scheduling service operated by Beacon LLC, including its handling of Google user data.",
};

export default function PrivacyPolicyPage() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-12 text-gray-800">
			<h1 className="mb-2 font-bold text-3xl">Privacy Policy</h1>
			<p className="mb-8 text-gray-500 text-sm">Effective date: May 21, 2026</p>

			<p className="mb-4 leading-relaxed">
				Beacon LLC (“Beacon,” “we,” “us,” or “our”) operates the scheduling
				service available at facilitypresence.com and cal.facilitypresence.com
				(the “Service”). This Privacy Policy explains what information we
				collect, how we use it, and the choices you have.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">
				1. Information We Collect
			</h2>
			<ul className="mb-4 list-disc space-y-1 pl-6 leading-relaxed">
				<li>
					<strong>Account information:</strong> your name, email address, and
					credentials provided when creating an account.
				</li>
				<li>
					<strong>Scheduling information:</strong> event types, availability,
					bookings, meeting details, and attendee information you or your
					invitees provide.
				</li>
				<li>
					<strong>
						Google account data (only if you connect Google Calendar):
					</strong>{" "}
					your basic Google profile and, via the Google Calendar API, your
					calendar events and availability. With your consent we request the
					scopes <code>userinfo.profile</code>, <code>calendar.events</code>,
					and <code>calendar.readonly</code>.
				</li>
				<li>
					<strong>Usage and device data:</strong> log data such as IP address,
					browser type, and pages accessed, used to operate and secure the
					Service.
				</li>
			</ul>

			<h2 className="mt-8 mb-2 font-semibold text-xl">
				2. How We Use Information
			</h2>
			<ul className="mb-4 list-disc space-y-1 pl-6 leading-relaxed">
				<li>
					To provide and operate scheduling features, including creating,
					updating, and canceling bookings.
				</li>
				<li>
					To read and write calendar events on your behalf so the Service can
					check availability and add scheduled meetings to your connected Google
					Calendar.
				</li>
				<li>
					To communicate with you about your account and bookings, such as
					confirmations and reminders.
				</li>
				<li>
					To maintain the security, integrity, and reliability of the Service.
				</li>
			</ul>

			<h2 className="mt-8 mb-2 font-semibold text-xl">
				3. Google User Data and Limited Use
			</h2>
			<p className="mb-4 leading-relaxed">
				Our use of information received from Google APIs adheres to the{" "}
				<a
					className="text-blue-600 underline"
					href="https://developers.google.com/terms/api-services-user-data-policy"
					target="_blank"
					rel="noopener noreferrer"
				>
					Google API Services User Data Policy
				</a>
				, including the Limited Use requirements. Specifically:
			</p>
			<ul className="mb-4 list-disc space-y-1 pl-6 leading-relaxed">
				<li>
					We only use Google Calendar data to provide and improve user-facing
					scheduling features within the Service.
				</li>
				<li>
					We do not transfer Google user data to third parties except as
					necessary to provide or improve these features, to comply with
					applicable law, or in connection with a merger or acquisition.
				</li>
				<li>We do not use Google user data for advertising.</li>
				<li>
					We do not allow humans to read Google user data unless you have given
					explicit consent, it is necessary for security or to comply with law,
					or the data has been aggregated and anonymized.
				</li>
			</ul>
			<p className="mb-4 border-gray-300 border-l-4 pl-4 italic leading-relaxed">
				Beacon LLC’s use and transfer to any other app of information received
				from Google APIs will adhere to the Google API Services User Data
				Policy, including the Limited Use requirements.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">
				4. How We Share Information
			</h2>
			<p className="mb-4 leading-relaxed">
				We do not sell your personal information. We may share information with
				service providers who help us operate the Service (under confidentiality
				obligations), with your meeting invitees to the extent necessary to
				schedule meetings, and with authorities when required by law. Google
				user data is handled in accordance with the Limited Use terms above.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">
				5. Data Retention and Deletion
			</h2>
			<p className="mb-4 leading-relaxed">
				We retain your information for as long as your account is active or as
				needed to provide the Service. You can disconnect Google Calendar at any
				time from your account settings, which revokes our access to your Google
				data. You may request deletion of your account and associated data by
				emailing{" "}
				<a
					className="text-blue-600 underline"
					href="mailto:shuttlementoradm@gmail.com"
				>
					shuttlementoradm@gmail.com
				</a>
				. You can also revoke access from your{" "}
				<a
					className="text-blue-600 underline"
					href="https://myaccount.google.com/permissions"
					target="_blank"
					rel="noopener noreferrer"
				>
					Google Account permissions page
				</a>
				.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">6. Security</h2>
			<p className="mb-4 leading-relaxed">
				We use reasonable administrative, technical, and physical safeguards to
				protect your information. No method of transmission or storage is
				completely secure, and we cannot guarantee absolute security.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">7. Children’s Privacy</h2>
			<p className="mb-4 leading-relaxed">
				The Service is not directed to children under 13, and we do not
				knowingly collect their information.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">
				8. Changes to This Policy
			</h2>
			<p className="mb-4 leading-relaxed">
				We may update this Privacy Policy from time to time. Material changes
				will be reflected by updating the effective date above.
			</p>

			<h2 className="mt-8 mb-2 font-semibold text-xl">9. Contact Us</h2>
			<p className="mb-4 leading-relaxed">
				Beacon LLC
				<br />
				Email:{" "}
				<a
					className="text-blue-600 underline"
					href="mailto:shuttlementoradm@gmail.com"
				>
					shuttlementoradm@gmail.com
				</a>
			</p>
		</main>
	);
}
