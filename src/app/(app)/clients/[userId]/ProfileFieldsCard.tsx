"use client";

import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

// Client-side shape of the per-club member record (MemberClubProfile). Matches
// the Zod schema in `src/server/api/routers/user.ts`. dateOfBirth is NOT here —
// it is global (User.dateOfBirth) and arrives as its own prop.
type ProfileData = {
	phone?: string;
	streetAddress?: string;
	city?: string;
	state?: string;
	zipCode?: string;
	emergencyContactName?: string;
	emergencyContactPhone?: string;
	emergencyContactRelationship?: string;
	referralSource?: string;
	howHeard?: string;
	medicalNotes?: string;
	allergies?: string;
	generalNotes?: string;
};

// Editable string fields (everything except the global DOB, tracked separately).
type FormState = Required<{ [K in keyof ProfileData]: string }>;

function calculateAge(dateOfBirth: string | undefined): number | null {
	if (!dateOfBirth) return null;
	const dob = new Date(dateOfBirth);
	if (Number.isNaN(dob.getTime())) return null;
	const now = new Date();
	let age = now.getFullYear() - dob.getFullYear();
	const m = now.getMonth() - dob.getMonth();
	if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
	return age >= 0 ? age : null;
}

interface ProfileFieldsCardProps {
	userId: string;
	email: string | null;
	// Global DOB (User.dateOfBirth) as a YYYY-MM-DD string, or null.
	dateOfBirth: string | null;
	profileData: ProfileData;
}

export default function ProfileFieldsCard({
	userId,
	email,
	dateOfBirth,
	profileData,
}: ProfileFieldsCardProps) {
	const utils = api.useUtils();
	const { toast } = useToast();
	const [editing, setEditing] = useState(false);

	const propsToForm = (): FormState => ({
		phone: profileData.phone ?? "",
		streetAddress: profileData.streetAddress ?? "",
		city: profileData.city ?? "",
		state: profileData.state ?? "",
		zipCode: profileData.zipCode ?? "",
		emergencyContactName: profileData.emergencyContactName ?? "",
		emergencyContactPhone: profileData.emergencyContactPhone ?? "",
		emergencyContactRelationship:
			profileData.emergencyContactRelationship ?? "",
		referralSource: profileData.referralSource ?? "",
		howHeard: profileData.howHeard ?? "",
		medicalNotes: profileData.medicalNotes ?? "",
		allergies: profileData.allergies ?? "",
		generalNotes: profileData.generalNotes ?? "",
	});

	const [form, setForm] = useState<FormState>(propsToForm);
	const [dob, setDob] = useState(dateOfBirth ?? "");

	const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
		setForm((f) => ({ ...f, [k]: e.target.value }));

	const updateMutation = api.user.updateStudentProfileData.useMutation({
		onSuccess: () => {
			void utils.user.getStudentDetail.invalidate({ userId });
			toast("Profile updated", "success");
			setEditing(false);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	function handleCancel() {
		setForm(propsToForm());
		setDob(dateOfBirth ?? "");
		setEditing(false);
	}

	function handleSave() {
		const t = (s: string) => s.trim() || undefined;
		updateMutation.mutate({
			userId,
			profileData: {
				phone: t(form.phone),
				streetAddress: t(form.streetAddress),
				city: t(form.city),
				state: t(form.state),
				zipCode: t(form.zipCode),
				emergencyContactName: t(form.emergencyContactName),
				emergencyContactPhone: t(form.emergencyContactPhone),
				emergencyContactRelationship: t(form.emergencyContactRelationship),
				referralSource: t(form.referralSource),
				howHeard: t(form.howHeard),
				medicalNotes: t(form.medicalNotes),
				allergies: t(form.allergies),
				generalNotes: t(form.generalNotes),
			},
			// Global DOB, written straight to User.dateOfBirth ("" clears it).
			dateOfBirth: dob.trim() || null,
		});
	}

	const age = calculateAge(dateOfBirth ?? undefined);
	const textareaClass =
		"flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<div className="mb-3 flex items-center justify-between">
				<h4 className="font-semibold text-[var(--foreground)] text-sm">
					Profile
				</h4>
				{!editing && (
					<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
						<Pencil size={14} />
						Edit
					</Button>
				)}
			</div>

			{editing ? (
				<div className="space-y-5">
					{/* Contact */}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field label="Email">
							<Input
								value={email ?? ""}
								disabled
								className="bg-[var(--muted)]"
							/>
						</Field>
						<Field label="Phone">
							<Input
								value={form.phone}
								onChange={set("phone")}
								placeholder="e.g. +1 555 123 4567"
								maxLength={32}
							/>
						</Field>
						<Field label="Date of birth">
							<Input
								type="date"
								value={dob}
								onChange={(e) => setDob(e.target.value)}
							/>
						</Field>
						<Field label="Age">
							<Input
								value={
									calculateAge(dob) !== null ? String(calculateAge(dob)) : ""
								}
								disabled
								className="bg-[var(--muted)]"
							/>
						</Field>
					</div>

					{/* Address */}
					<div className="space-y-3">
						<SectionLabel>Address</SectionLabel>
						<Field label="Street address">
							<Input
								value={form.streetAddress}
								onChange={set("streetAddress")}
								maxLength={200}
							/>
						</Field>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<Field label="City">
								<Input
									value={form.city}
									onChange={set("city")}
									maxLength={100}
								/>
							</Field>
							<Field label="State">
								<Input
									value={form.state}
									onChange={set("state")}
									maxLength={50}
								/>
							</Field>
							<Field label="ZIP">
								<Input
									value={form.zipCode}
									onChange={set("zipCode")}
									maxLength={20}
								/>
							</Field>
						</div>
					</div>

					{/* Emergency contact */}
					<div className="space-y-3">
						<SectionLabel>Emergency contact</SectionLabel>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Field label="Name">
								<Input
									value={form.emergencyContactName}
									onChange={set("emergencyContactName")}
									maxLength={120}
								/>
							</Field>
							<Field label="Phone">
								<Input
									value={form.emergencyContactPhone}
									onChange={set("emergencyContactPhone")}
									maxLength={32}
								/>
							</Field>
							<Field label="Relationship">
								<Input
									value={form.emergencyContactRelationship}
									onChange={set("emergencyContactRelationship")}
									placeholder="e.g. Parent, Spouse"
									maxLength={50}
								/>
							</Field>
						</div>
					</div>

					{/* How they heard */}
					<div className="space-y-3">
						<SectionLabel>How they heard</SectionLabel>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Field label="Referral source">
								<Input
									value={form.referralSource}
									onChange={set("referralSource")}
									placeholder="e.g. Friend, Google, Instagram"
									maxLength={120}
								/>
							</Field>
							<Field label="How heard">
								<Input
									value={form.howHeard}
									onChange={set("howHeard")}
									maxLength={120}
								/>
							</Field>
						</div>
					</div>

					{/* Notes */}
					<div className="space-y-3">
						<SectionLabel>Notes</SectionLabel>
						<Field label="Medical notes">
							<textarea
								value={form.medicalNotes}
								onChange={set("medicalNotes")}
								rows={3}
								maxLength={2000}
								placeholder="Conditions, medications, emergency info"
								className={textareaClass}
							/>
						</Field>
						<Field label="Allergies">
							<textarea
								value={form.allergies}
								onChange={set("allergies")}
								rows={2}
								maxLength={1000}
								placeholder="Food, medication, or environmental allergies"
								className={textareaClass}
							/>
						</Field>
						<Field label="General notes">
							<textarea
								value={form.generalNotes}
								onChange={set("generalNotes")}
								rows={3}
								maxLength={5000}
								placeholder="Anything else staff should know"
								className={textareaClass}
							/>
						</Field>
					</div>

					<div className="flex items-center justify-end gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleCancel}
							disabled={updateMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleSave}
							disabled={updateMutation.isPending}
						>
							{updateMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
				</div>
			) : (
				<div className="space-y-4 text-sm">
					<dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6">
						<ReadField label="Email" value={email} />
						<ReadField label="Phone" value={profileData.phone ?? null} />
						<ReadField label="Date of birth" value={dateOfBirth} />
						<ReadField label="Age" value={age !== null ? String(age) : null} />
					</dl>

					<ReadSection label="Address">
						<div className="sm:col-span-2">
							<ReadField
								label="Street address"
								value={profileData.streetAddress ?? null}
							/>
						</div>
						<ReadField label="City" value={profileData.city ?? null} />
						<ReadField label="State" value={profileData.state ?? null} />
						<ReadField label="ZIP" value={profileData.zipCode ?? null} />
					</ReadSection>

					<ReadSection label="Emergency contact">
						<ReadField
							label="Name"
							value={profileData.emergencyContactName ?? null}
						/>
						<ReadField
							label="Phone"
							value={profileData.emergencyContactPhone ?? null}
						/>
						<ReadField
							label="Relationship"
							value={profileData.emergencyContactRelationship ?? null}
						/>
					</ReadSection>

					<ReadSection label="How they heard">
						<ReadField
							label="Referral source"
							value={profileData.referralSource ?? null}
						/>
						<ReadField label="How heard" value={profileData.howHeard ?? null} />
					</ReadSection>

					<div>
						<SectionLabel>Notes</SectionLabel>
						<dl className="mt-2 grid grid-cols-1 gap-y-3">
							<ReadField
								label="Medical notes"
								value={profileData.medicalNotes ?? null}
								block
							/>
							<ReadField
								label="Allergies"
								value={profileData.allergies ?? null}
								block
							/>
							<ReadField
								label="General notes"
								value={profileData.generalNotes ?? null}
								block
							/>
						</dl>
					</div>
				</div>
			)}
		</div>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="space-y-1">
			{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps the control via children */}
			<label className="font-medium text-[var(--foreground)] text-sm">
				{label}
			</label>
			{children}
		</div>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<h5 className="font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
			{children}
		</h5>
	);
}

function ReadSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div>
			<SectionLabel>{label}</SectionLabel>
			<dl className="mt-2 grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6">
				{children}
			</dl>
		</div>
	);
}

function ReadField({
	label,
	value,
	block,
}: {
	label: string;
	value: string | null;
	block?: boolean;
}) {
	return (
		<div>
			<dt className="font-medium text-[var(--muted-foreground)] text-xs">
				{label}
			</dt>
			<dd
				className={`mt-0.5 text-[var(--foreground)] ${
					block ? "whitespace-pre-wrap" : "truncate"
				} ${value ? "" : "text-[var(--muted-foreground)] italic"}`}
			>
				{value || "—"}
			</dd>
		</div>
	);
}
