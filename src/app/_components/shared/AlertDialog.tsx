"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/app/_components/shared/Button";

interface AlertDialogProps {
	open: boolean;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	/** Disables the confirm button (e.g. while a required input is empty). */
	confirmDisabled?: boolean;
	/**
	 * Optional extra body content (e.g. a required reason input) rendered
	 * between the description and the action buttons.
	 */
	children?: ReactNode;
	onConfirm: () => void;
	onCancel: () => void;
}

export function AlertDialog({
	open,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	confirmDisabled = false,
	children,
	onConfirm,
	onCancel,
}: AlertDialogProps) {
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center">
			{/* Backdrop — click to dismiss. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: supplementary click-to-dismiss; the dialog is fully operable via the Cancel/Confirm buttons. */}
			<div
				className="absolute inset-0 bg-black/40 backdrop-blur-sm"
				onClick={onCancel}
			/>

			{/* Dialog */}
			<div className="glass-panel relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-[var(--border)] p-6 shadow-xl">
				<div className="flex items-start gap-3">
					{destructive && (
						<AlertTriangle
							size={20}
							className="mt-0.5 shrink-0 text-[var(--destructive)]"
						/>
					)}
					<div className="space-y-1">
						<h2 className="font-semibold text-[var(--foreground)] text-sm">
							{title}
						</h2>
						<p className="text-[var(--muted-foreground)] text-sm">
							{description}
						</p>
					</div>
				</div>

				{children && <div>{children}</div>}

				<div className="flex justify-end gap-2">
					<Button variant="outline" size="sm" onClick={onCancel}>
						{cancelLabel}
					</Button>
					<Button
						size="sm"
						disabled={confirmDisabled}
						onClick={onConfirm}
						className={
							destructive
								? "border-transparent bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:bg-red-600"
								: ""
						}
					>
						{confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
