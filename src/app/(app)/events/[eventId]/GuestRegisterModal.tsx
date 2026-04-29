"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

interface GuestRegisterModalProps {
	clubShortName: string;
	eventId: string;
	eventTitle: string;
	onClose: () => void;
	onSuccess: (registeredEmail: string) => void;
}

/**
 * Guest-register form for free public events. (public-shop.md decision D3 / Tier 1)
 * Calls `shop.guestRegisterForFreeEvent`. On success, hands the email back to the
 * parent so it can render the post-register banner state.
 */
export default function GuestRegisterModal({
	clubShortName,
	eventId,
	eventTitle,
	onClose,
	onSuccess,
}: GuestRegisterModalProps) {
	const { toast } = useToast();
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");

	const registerMutation = api.shop.guestRegisterForFreeEvent.useMutation({
		onSuccess: (data) => {
			onSuccess(data.email);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!firstName.trim() || !lastName.trim() || !email.trim()) {
			toast("Please fill all fields", "error");
			return;
		}
		registerMutation.mutate({
			clubShortName,
			eventId,
			email: email.trim(),
			firstName: firstName.trim(),
			lastName: lastName.trim(),
		});
	};

	const saving = registerMutation.isPending;

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : onClose}
			/>

			{/* Modal */}
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="guest-register-title"
				className="glass-panel -translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 mx-4 w-full max-w-md rounded-lg border border-[var(--border)] shadow-xl"
			>
				<form onSubmit={handleSubmit}>
					{/* Header */}
					<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
						<h2
							id="guest-register-title"
							className="font-semibold text-[var(--foreground)] text-base"
						>
							Register for {eventTitle}
						</h2>
						<button
							type="button"
							onClick={onClose}
							disabled={saving}
							className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
							aria-label="Close"
						>
							<X size={18} />
						</button>
					</div>

					{/* Body */}
					<div className="space-y-4 px-6 py-5">
						<p className="text-[var(--muted-foreground)] text-xs">
							We'll create an account for you so you can manage this
							registration. Use the registrant's own email — a sign-in link can
							be sent there.
						</p>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1">
								<label
									htmlFor="guest-first-name"
									className="font-medium text-[var(--foreground)] text-sm"
								>
									First name <span className="text-red-500">*</span>
								</label>
								<Input
									id="guest-first-name"
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									disabled={saving}
									required
									autoFocus
								/>
							</div>
							<div className="space-y-1">
								<label
									htmlFor="guest-last-name"
									className="font-medium text-[var(--foreground)] text-sm"
								>
									Last name <span className="text-red-500">*</span>
								</label>
								<Input
									id="guest-last-name"
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									disabled={saving}
									required
								/>
							</div>
						</div>

						<div className="space-y-1">
							<label
								htmlFor="guest-email"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Email <span className="text-red-500">*</span>
							</label>
							<Input
								id="guest-email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								disabled={saving}
								required
							/>
						</div>
					</div>

					{/* Footer */}
					<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onClose}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={saving}>
							{saving ? "Registering…" : "Register"}
						</Button>
					</div>
				</form>
			</div>
		</>
	);
}
