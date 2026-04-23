"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

// Client-side shape of StudentProfile.profileData (TD-1). Matches the Zod
// schema in `src/server/api/routers/user.ts` — kept as a separate local type
// on purpose: small duplication beats a shared types file for 5 fields.
type ProfileData = {
	phone?: string;
	dateOfBirth?: string;
	medicalNotes?: string;
	allergies?: string;
	generalNotes?: string;
};

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
	profileData: ProfileData;
}

export default function ProfileFieldsCard({
	userId,
	email,
	profileData,
}: ProfileFieldsCardProps) {
	const utils = api.useUtils();
	const { toast } = useToast();
	const [editing, setEditing] = useState(false);
	const [phone, setPhone] = useState(profileData.phone ?? "");
	const [dateOfBirth, setDateOfBirth] = useState(profileData.dateOfBirth ?? "");
	const [medicalNotes, setMedicalNotes] = useState(
		profileData.medicalNotes ?? "",
	);
	const [allergies, setAllergies] = useState(profileData.allergies ?? "");
	const [generalNotes, setGeneralNotes] = useState(
		profileData.generalNotes ?? "",
	);

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
		setPhone(profileData.phone ?? "");
		setDateOfBirth(profileData.dateOfBirth ?? "");
		setMedicalNotes(profileData.medicalNotes ?? "");
		setAllergies(profileData.allergies ?? "");
		setGeneralNotes(profileData.generalNotes ?? "");
		setEditing(false);
	}

	function handleSave() {
		updateMutation.mutate({
			userId,
			profileData: {
				phone: phone.trim() || undefined,
				dateOfBirth: dateOfBirth.trim() || undefined,
				medicalNotes: medicalNotes.trim() || undefined,
				allergies: allergies.trim() || undefined,
				generalNotes: generalNotes.trim() || undefined,
			},
		});
	}

	const age = calculateAge(profileData.dateOfBirth);
	const textareaClass =
		"flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<div className="mb-3 flex items-center justify-between">
				<h4 className="font-semibold text-[var(--foreground)] text-sm">
					Profile
				</h4>
				{!editing && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setEditing(true)}
					>
						<Pencil size={14} />
						Edit
					</Button>
				)}
			</div>

			{editing ? (
				<div className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Email
							</label>
							<Input
								value={email ?? ""}
								disabled
								className="bg-[var(--muted)]"
							/>
						</div>
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Phone
							</label>
							<Input
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								placeholder="e.g. +1 555 123 4567"
								maxLength={40}
							/>
						</div>
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Date of birth
							</label>
							<Input
								type="date"
								value={dateOfBirth}
								onChange={(e) => setDateOfBirth(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Age
							</label>
							<Input
								value={
									calculateAge(dateOfBirth) !== null
										? String(calculateAge(dateOfBirth))
										: ""
								}
								disabled
								className="bg-[var(--muted)]"
							/>
						</div>
					</div>

					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Medical notes
						</label>
						<textarea
							value={medicalNotes}
							onChange={(e) => setMedicalNotes(e.target.value)}
							rows={3}
							maxLength={2000}
							placeholder="Conditions, medications, emergency info"
							className={textareaClass}
						/>
					</div>

					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Allergies
						</label>
						<textarea
							value={allergies}
							onChange={(e) => setAllergies(e.target.value)}
							rows={2}
							maxLength={1000}
							placeholder="Food, medication, or environmental allergies"
							className={textareaClass}
						/>
					</div>

					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							General notes
						</label>
						<textarea
							value={generalNotes}
							onChange={(e) => setGeneralNotes(e.target.value)}
							rows={3}
							maxLength={5000}
							placeholder="Anything else staff should know"
							className={textareaClass}
						/>
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
				<dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-6">
					<ReadField label="Email" value={email} />
					<ReadField label="Phone" value={profileData.phone ?? null} />
					<ReadField
						label="Date of birth"
						value={profileData.dateOfBirth ?? null}
					/>
					<ReadField
						label="Age"
						value={age !== null ? String(age) : null}
					/>
					<div className="sm:col-span-2">
						<ReadField
							label="Medical notes"
							value={profileData.medicalNotes ?? null}
							block
						/>
					</div>
					<div className="sm:col-span-2">
						<ReadField
							label="Allergies"
							value={profileData.allergies ?? null}
							block
						/>
					</div>
					<div className="sm:col-span-2">
						<ReadField
							label="General notes"
							value={profileData.generalNotes ?? null}
							block
						/>
					</div>
				</dl>
			)}
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
