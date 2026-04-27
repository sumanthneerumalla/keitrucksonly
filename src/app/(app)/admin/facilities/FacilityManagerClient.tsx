"use client";

import {
	ArrowLeft,
	Building2,
	Pencil,
	Plus,
	ToggleLeft,
	ToggleRight,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { Select } from "~/app/_components/shared/ui/select";
import { TIMEZONE_OPTIONS } from "~/lib/timezones";
import { api } from "~/trpc/react";

export default function FacilityManagerClient() {
	const utils = api.useUtils();
	const { data: facilities, isLoading } = api.calendar.getFacilities.useQuery();

	// Form state
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [streetAddress, setStreetAddress] = useState("");
	const [city, setCity] = useState("");
	const [state, setState] = useState("");
	const [zipCode, setZipCode] = useState("");
	const [phone, setPhone] = useState("");
	const [email, setEmail] = useState("");
	// Empty string = "use schema default" (America/New_York). The backend treats
	// undefined the same way; we only send a non-empty value through.
	const [timezone, setTimezone] = useState("");

	const createMutation = api.calendar.createFacility.useMutation({
		onSuccess: () => {
			void utils.calendar.getFacilities.invalidate();
			resetForm();
		},
	});

	const updateMutation = api.calendar.updateFacility.useMutation({
		onSuccess: () => {
			void utils.calendar.getFacilities.invalidate();
			resetForm();
		},
	});

	const deactivateMutation = api.calendar.deactivateFacility.useMutation({
		onSuccess: () => void utils.calendar.getFacilities.invalidate(),
	});

	const reactivateMutation = api.calendar.updateFacility.useMutation({
		onSuccess: () => void utils.calendar.getFacilities.invalidate(),
	});

	function resetForm() {
		setShowForm(false);
		setEditingId(null);
		setName("");
		setStreetAddress("");
		setCity("");
		setState("");
		setZipCode("");
		setPhone("");
		setEmail("");
		setTimezone("");
	}

	function startEdit(f: {
		facilityId: string;
		name: string;
		streetAddress: string | null;
		city: string | null;
		state: string | null;
		zipCode: string | null;
		phone: string | null;
		email: string | null;
		timezone: string;
	}) {
		setEditingId(f.facilityId);
		setName(f.name);
		setStreetAddress(f.streetAddress ?? "");
		setCity(f.city ?? "");
		setState(f.state ?? "");
		setZipCode(f.zipCode ?? "");
		setPhone(f.phone ?? "");
		setEmail(f.email ?? "");
		setTimezone(f.timezone);
		setShowForm(false);
	}

	function handleSave() {
		if (!name.trim()) return;
		const data = {
			name: name.trim(),
			streetAddress: streetAddress.trim() || undefined,
			city: city.trim() || undefined,
			state: state.trim() || undefined,
			zipCode: zipCode.trim() || undefined,
			phone: phone.trim() || undefined,
			email: email.trim() || undefined,
			// Send timezone only when staff picked one; empty string = "use schema
			// default" so we omit. Avoids sending "" which would fail validation.
			timezone: timezone.trim() || undefined,
		};
		if (editingId) {
			updateMutation.mutate({ facilityId: editingId, ...data });
		} else {
			createMutation.mutate(data);
		}
	}

	const isSaving = createMutation.isPending || updateMutation.isPending;
	const error =
		createMutation.error ?? updateMutation.error ?? deactivateMutation.error;

	function formatAddress(f: {
		streetAddress: string | null;
		city: string | null;
		state: string | null;
		zipCode: string | null;
	}): string | null {
		const parts = [
			f.streetAddress,
			[f.city, f.state, f.zipCode].filter(Boolean).join(", "),
		].filter(Boolean);
		return parts.length > 0 ? parts.join(", ") : null;
	}

	return (
		<div className="p-6">
			<div className="mb-6 flex items-center gap-4">
				<Link
					href="/admin"
					className="flex items-center gap-2 text-[var(--muted-foreground)] text-sm transition-colors hover:text-[var(--foreground)]"
				>
					<ArrowLeft size={16} />
					Back to Admin
				</Link>
				<h1 className="font-semibold text-2xl text-[var(--foreground)]">
					Manage Facilities
				</h1>
			</div>

			<div className="mx-auto max-w-2xl">
				<div className="mb-4 flex items-center justify-between">
					<p className="text-[var(--muted-foreground)] text-sm">
						Create and manage physical locations for your club.
					</p>
					<Button
						size="sm"
						onClick={() => {
							resetForm();
							setShowForm(true);
						}}
					>
						<Plus size={14} />
						Add Facility
					</Button>
				</div>

				{/* Create / Edit form */}
				{(showForm || editingId) && (
					<div className="glass-inset mb-4 space-y-3 p-4">
						<p className="font-medium text-[var(--foreground)] text-sm">
							{editingId ? "Edit Facility" : "New Facility"}
						</p>
						<div>
							<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
								Name *
							</label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Downtown Gym"
								maxLength={200}
							/>
						</div>
						<div>
							<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
								Street Address
							</label>
							<Input
								value={streetAddress}
								onChange={(e) => setStreetAddress(e.target.value)}
								placeholder="123 Main St"
							/>
						</div>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<div className="col-span-2 sm:col-span-1">
								<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
									City
								</label>
								<Input
									value={city}
									onChange={(e) => setCity(e.target.value)}
									placeholder="City"
								/>
							</div>
							<div>
								<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
									State
								</label>
								<Input
									value={state}
									onChange={(e) => setState(e.target.value)}
									placeholder="State"
								/>
							</div>
							<div>
								<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
									Zip
								</label>
								<Input
									value={zipCode}
									onChange={(e) => setZipCode(e.target.value)}
									placeholder="12345"
									maxLength={20}
								/>
							</div>
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
									Phone
								</label>
								<Input
									value={phone}
									onChange={(e) => setPhone(e.target.value)}
									placeholder="(555) 123-4567"
									maxLength={30}
								/>
							</div>
							<div>
								<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
									Email
								</label>
								<Input
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="facility@example.com"
									type="email"
								/>
							</div>
						</div>
						<div>
							<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
								Time Zone
							</label>
							<Select
								value={timezone}
								onChange={(e) => setTimezone(e.target.value)}
							>
								<option value="">Use default (Eastern Time)</option>
								{TIMEZONE_OPTIONS.map((tz) => (
									<option key={tz.value} value={tz.value}>
										{tz.label}
									</option>
								))}
							</Select>
							<p className="mt-1 text-[var(--muted-foreground)] text-xs">
								Used for displaying event times and calculating package
								expiry. Leave as default unless this facility is in a
								different time zone than the rest of your club.
							</p>
						</div>
						{error && <p className="text-red-500 text-xs">{error.message}</p>}
						<div className="flex gap-2">
							<Button
								size="sm"
								onClick={handleSave}
								disabled={!name.trim() || isSaving}
							>
								{isSaving ? "Saving…" : "Save"}
							</Button>
							<Button size="sm" variant="outline" onClick={resetForm}>
								Cancel
							</Button>
						</div>
					</div>
				)}

				{/* Facility list */}
				{isLoading ? (
					<div className="animate-pulse space-y-3">
						<div className="h-20 rounded-lg bg-gray-200" />
						<div className="h-20 rounded-lg bg-gray-200" />
					</div>
				) : facilities && facilities.length > 0 ? (
					<div className="space-y-3">
						{facilities.map((f) => {
							const addr = formatAddress(f);
							return (
								<div
									key={f.facilityId}
									className={`glass-card rounded-lg p-4 ${!f.isActive ? "opacity-60" : ""}`}
								>
									<div className="flex items-start justify-between">
										<div className="flex items-center gap-3">
											<Building2
												size={18}
												className={
													f.isActive ? "text-[var(--primary)]" : "text-gray-400"
												}
											/>
											<div>
												<p className="font-medium text-[var(--foreground)]">
													{f.name}
													{!f.isActive && (
														<span className="ml-2 text-gray-400 text-xs">
															(inactive)
														</span>
													)}
												</p>
												{addr && (
													<p className="text-[var(--muted-foreground)] text-xs">
														{addr}
													</p>
												)}
												{(f.phone || f.email) && (
													<p className="text-[var(--muted-foreground)] text-xs">
														{[f.phone, f.email].filter(Boolean).join(" · ")}
													</p>
												)}
												<p className="mt-1 text-[var(--muted-foreground)] text-xs">
													{f.resourceCount} resource
													{f.resourceCount !== 1 ? "s" : ""}
													{" · "}
													{f.eventCount} event{f.eventCount !== 1 ? "s" : ""}
												</p>
											</div>
										</div>
										<div className="flex gap-1">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => startEdit(f)}
												aria-label="Edit"
											>
												<Pencil size={14} />
											</Button>
											{f.isActive ? (
												<Button
													variant="ghost"
													size="icon"
													className="hover:bg-red-50 hover:text-red-600"
													onClick={() => {
														if (
															confirm(
																`Deactivate "${f.name}"? Resources must be reassigned first.`,
															)
														) {
															deactivateMutation.mutate({
																facilityId: f.facilityId,
															});
														}
													}}
													aria-label="Deactivate"
												>
													<ToggleRight size={16} className="text-green-600" />
												</Button>
											) : (
												<Button
													variant="ghost"
													size="icon"
													onClick={() =>
														reactivateMutation.mutate({
															facilityId: f.facilityId,
															isActive: true,
														})
													}
													aria-label="Reactivate"
												>
													<ToggleLeft size={16} />
												</Button>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<p className="py-8 text-center text-[var(--muted-foreground)] text-sm">
						No facilities yet. Create one to get started.
					</p>
				)}
			</div>
		</div>
	);
}
