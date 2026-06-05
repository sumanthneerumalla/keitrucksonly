"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { COLOR_OPTIONS } from "~/lib/constants";
import { api } from "~/trpc/react";
import { Button } from "./Button";
import { Input } from "./Input";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManageTagsDialogProps {
	open: boolean;
	onClose: () => void;
}

interface TagRow {
	tagId: string;
	name: string;
	bgColor: string;
	textColor: string;
	_count: { userTags: number };
}

// ---------------------------------------------------------------------------
// Delete Confirmation Dialog
// ---------------------------------------------------------------------------

function DeleteTagConfirmation({
	tag,
	onCancel,
	onConfirm,
	isPending,
}: {
	tag: TagRow;
	onCancel: () => void;
	onConfirm: () => void;
	isPending: boolean;
}) {
	return (
		<Dialog open onOpenChange={(v) => !v && onCancel()}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>Delete Tag</DialogTitle>
					<DialogDescription>
						Delete &lsquo;<span className="capitalize">{tag.name}</span>&rsquo;?
						This will remove it from {tag._count.userTags} user
						{tag._count.userTags !== 1 ? "s" : ""}.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onCancel} disabled={isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={onConfirm}
						disabled={isPending}
					>
						{isPending ? "Deleting..." : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Inline Edit Name
// ---------------------------------------------------------------------------

function InlineTagName({
	tag,
	onRename,
}: {
	tag: TagRow;
	onRename: (newName: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(tag.name);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	function commit() {
		const trimmed = draft.trim();
		if (trimmed && trimmed.toLowerCase() !== tag.name) {
			onRename(trimmed);
		}
		setEditing(false);
	}

	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => {
					setDraft(tag.name);
					setEditing(true);
				}}
				aria-label="Rename tag"
				className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm hover:bg-gray-100"
			>
				<span className="font-medium text-[var(--foreground)] capitalize">
					{tag.name}
				</span>
				<Pencil
					size={12}
					className="shrink-0 text-gray-400 opacity-0 group-hover:opacity-100"
				/>
			</button>
		);
	}

	return (
		<Input
			ref={inputRef}
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") commit();
				if (e.key === "Escape") {
					setDraft(tag.name);
					setEditing(false);
				}
			}}
			className="h-8 w-40 px-2 py-1 text-sm"
			maxLength={50}
		/>
	);
}

// ---------------------------------------------------------------------------
// Color Picker Row
// ---------------------------------------------------------------------------

function ColorPickerRow({
	currentBg,
	onSelect,
}: {
	currentBg: string;
	onSelect: (bg: string, text: string) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1">
			{COLOR_OPTIONS.map((c) => (
				<button
					key={c.bg}
					type="button"
					title={c.label}
					aria-label={c.label}
					onClick={() => {
						if (c.bg !== currentBg) onSelect(c.bg, c.text);
					}}
					className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 transition-transform hover:scale-110"
					style={{ backgroundColor: c.bg }}
				>
					{c.bg === currentBg && <Check size={12} style={{ color: c.text }} />}
				</button>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// ManageTagsDialog
// ---------------------------------------------------------------------------

export default function ManageTagsDialog({
	open,
	onClose,
}: ManageTagsDialogProps) {
	const utils = api.useUtils();
	const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null);
	const [error, setError] = useState("");

	const { data: tags, isLoading } = api.user.listClubTags.useQuery(undefined, {
		enabled: open,
	});

	const updateMutation = api.user.updateTag.useMutation({
		onSuccess: () => {
			void utils.user.listClubTags.invalidate();
		},
		onError: (err) => setError(err.message),
	});

	const deleteMutation = api.user.deleteTag.useMutation({
		onSuccess: () => {
			void utils.user.listClubTags.invalidate();
			setDeleteTarget(null);
		},
		onError: (err) => setError(err.message),
	});

	function handleRename(tagId: string, newName: string) {
		setError("");
		updateMutation.mutate({ tagId, name: newName.toLowerCase() });
	}

	function handleRecolor(tagId: string, bgColor: string, textColor: string) {
		setError("");
		updateMutation.mutate({ tagId, bgColor, textColor });
	}

	function handleDelete() {
		if (!deleteTarget) return;
		setError("");
		deleteMutation.mutate({ tagId: deleteTarget.tagId });
	}

	return (
		<>
			<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>Manage Tags</DialogTitle>
						<DialogDescription>
							Rename, recolor, or delete tags for your club.
						</DialogDescription>
					</DialogHeader>

					<DialogBody>
						{isLoading ? (
							<div className="space-y-3">
								{Array.from({ length: 3 }).map((_, i) => (
									<div
										key={i}
										className="h-10 animate-pulse rounded-lg bg-gray-100"
									/>
								))}
							</div>
						) : !tags || tags.length === 0 ? (
							<p className="py-4 text-center text-[var(--muted-foreground)] text-sm">
								No tags yet. Create tags from the user edit modal.
							</p>
						) : (
							<div className="max-h-[400px] space-y-3 overflow-y-auto">
								{(tags as TagRow[]).map((tag) => (
									<div
										key={tag.tagId}
										className="flex flex-col gap-2 rounded-lg border border-gray-200 px-3 py-2.5"
									>
										{/* Top row: color dot, name, usage, delete */}
										<div className="flex items-center gap-3">
											<span
												className="block h-4 w-4 shrink-0 rounded-full"
												style={{ backgroundColor: tag.bgColor }}
											/>
											<div className="min-w-0 flex-1">
												<InlineTagName
													tag={tag}
													onRename={(name) => handleRename(tag.tagId, name)}
												/>
											</div>
											<span className="shrink-0 text-[var(--muted-foreground)] text-xs">
												{tag._count.userTags} user
												{tag._count.userTags !== 1 ? "s" : ""}
											</span>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Delete tag"
												className="h-8 w-8 shrink-0 text-gray-400 hover:text-red-600"
												onClick={() => setDeleteTarget(tag)}
											>
												<Trash2 size={14} />
											</Button>
										</div>
										{/* Color picker row */}
										<ColorPickerRow
											currentBg={tag.bgColor}
											onSelect={(bg, text) =>
												handleRecolor(tag.tagId, bg, text)
											}
										/>
									</div>
								))}
							</div>
						)}

						{error && <p className="text-red-500 text-xs">{error}</p>}
					</DialogBody>

					<DialogFooter>
						<Button variant="outline" onClick={onClose}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete confirmation dialog */}
			{deleteTarget && (
				<DeleteTagConfirmation
					tag={deleteTarget}
					onCancel={() => setDeleteTarget(null)}
					onConfirm={handleDelete}
					isPending={deleteMutation.isPending}
				/>
			)}
		</>
	);
}
