"use client";

import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/app/_components/shared/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { COLOR_OPTIONS } from "~/lib/constants";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagEditorProps {
	selectedTagIds: string[];
	onChange: (tagIds: string[]) => void;
}

const MAX_TAGS_PER_USER = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomColorIndex(): number {
	return Math.floor(Math.random() * COLOR_OPTIONS.length);
}

// ---------------------------------------------------------------------------
// TagEditor
// ---------------------------------------------------------------------------

export function TagEditor({ selectedTagIds, onChange }: TagEditorProps) {
	const utils = api.useUtils();
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [creatingName, setCreatingName] = useState<string | null>(null);
	const [colorIdx, setColorIdx] = useState(randomColorIndex);

	const { data: tags = [] } = api.user.listClubTags.useQuery();

	const createTagMutation = api.user.createTag.useMutation({
		onSuccess: (newTag) => {
			void utils.user.listClubTags.invalidate();
			// Auto-select the newly created tag
			if (!selectedTagIds.includes(newTag.tagId)) {
				onChange([...selectedTagIds, newTag.tagId]);
			}
			setCreatingName(null);
			setSearch("");
		},
		onError: (err) => {
			setCreatingName(null);
			toast(err.message || "Failed to create tag", "error");
		},
	});

	// Derived data
	const selectedTags = useMemo(
		() => tags.filter((t) => selectedTagIds.includes(t.tagId)),
		[tags, selectedTagIds],
	);

	const sortedTags = useMemo(
		() => [...tags].sort((a, b) => a.name.localeCompare(b.name)),
		[tags],
	);

	const remaining = MAX_TAGS_PER_USER - selectedTagIds.length;

	const trimmedSearch = search.trim().toLowerCase();
	const exactMatch = tags.some((t) => t.name === trimmedSearch);
	const showCreateOption = trimmedSearch.length > 0 && !exactMatch;

	// Handlers
	const toggleTag = useCallback(
		(tagId: string) => {
			if (selectedTagIds.includes(tagId)) {
				onChange(selectedTagIds.filter((id) => id !== tagId));
			} else if (remaining > 0) {
				onChange([...selectedTagIds, tagId]);
			}
		},
		[selectedTagIds, onChange, remaining],
	);

	const removeTag = useCallback(
		(tagId: string) => {
			onChange(selectedTagIds.filter((id) => id !== tagId));
		},
		[selectedTagIds, onChange],
	);

	const startCreate = useCallback((name: string) => {
		setCreatingName(name);
		setColorIdx(randomColorIndex());
	}, []);

	const confirmCreate = useCallback(() => {
		if (!creatingName) return;
		const color = COLOR_OPTIONS[colorIdx]!;
		createTagMutation.mutate({
			name: creatingName,
			bgColor: color.bg,
			textColor: color.text,
		});
	}, [creatingName, colorIdx, createTagMutation]);

	return (
		<div className="space-y-2">
			{/* Selected tag pills */}
			{selectedTags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{selectedTags.map((tag) => (
						<span
							key={tag.tagId}
							className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs capitalize"
							style={{
								backgroundColor: tag.bgColor,
								color: tag.textColor,
							}}
						>
							{tag.name}
							<button
								type="button"
								onClick={() => removeTag(tag.tagId)}
								aria-label={`Remove tag ${tag.name}`}
								className="ml-0.5 rounded-full p-0.5 hover:opacity-70"
							>
								<X size={12} />
							</button>
						</span>
					))}
				</div>
			)}

			{/* Remaining count */}
			<p className="text-[var(--muted-foreground)] text-xs">
				{remaining} of {MAX_TAGS_PER_USER} tags remaining
			</p>

			{/* Combobox */}
			<Popover
				open={open}
				onOpenChange={(v) => {
					setOpen(v);
					if (!v) setCreatingName(null);
				}}
			>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className="w-full justify-between font-normal"
					>
						<span className="text-[var(--muted-foreground)]">
							Search or create tags...
						</span>
						<ChevronsUpDown size={14} className="ml-2 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-[--radix-popover-trigger-width] p-0"
					align="start"
				>
					{creatingName ? (
						/* Inline color picker for new tag */
						<div className="space-y-3 p-3">
							<div className="flex items-center gap-2">
								<span
									className="inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs capitalize"
									style={{
										backgroundColor: COLOR_OPTIONS[colorIdx]!.bg,
										color: COLOR_OPTIONS[colorIdx]!.text,
									}}
								>
									{creatingName}
								</span>
							</div>
							<div>
								<p className="mb-1.5 text-[var(--muted-foreground)] text-xs">
									Pick a color
								</p>
								<div className="flex flex-wrap gap-1.5">
									{COLOR_OPTIONS.map((c, i) => (
										<button
											key={c.label}
											type="button"
											onClick={() => setColorIdx(i)}
											className="relative flex h-6 w-6 items-center justify-center rounded-full"
											style={{ backgroundColor: c.bg }}
											title={c.label}
											aria-label={c.label}
										>
											{i === colorIdx && (
												<Check size={12} style={{ color: c.text }} />
											)}
										</button>
									))}
								</div>
							</div>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										setCreatingName(null);
										setSearch("");
									}}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={confirmCreate}
									disabled={createTagMutation.isPending}
								>
									{createTagMutation.isPending ? "Creating..." : "Create Tag"}
								</Button>
							</div>
						</div>
					) : (
						<Command shouldFilter={false}>
							<CommandInput
								placeholder="Search tags..."
								value={search}
								onValueChange={setSearch}
							/>
							<CommandList>
								<CommandEmpty>No tags found.</CommandEmpty>
								<CommandGroup>
									{sortedTags
										.filter((t) => t.name.includes(trimmedSearch))
										.map((tag) => {
											const isSelected = selectedTagIds.includes(tag.tagId);
											return (
												<CommandItem
													key={tag.tagId}
													value={tag.tagId}
													onSelect={() => toggleTag(tag.tagId)}
													disabled={!isSelected && remaining <= 0}
												>
													<span
														className="h-3 w-3 shrink-0 rounded-full"
														style={{
															backgroundColor: tag.bgColor,
														}}
													/>
													<span className="flex-1 capitalize">{tag.name}</span>
													{isSelected && (
														<Check
															size={14}
															className="text-[var(--primary)]"
														/>
													)}
												</CommandItem>
											);
										})}
								</CommandGroup>

								{/* "Create [name]" option */}
								{showCreateOption && (
									<CommandGroup>
										<CommandItem
											value={`create-${trimmedSearch}`}
											onSelect={() => startCreate(trimmedSearch)}
										>
											<Plus size={14} />
											<span>
												Create &ldquo;
												<span className="capitalize">{trimmedSearch}</span>
												&rdquo;
											</span>
										</CommandItem>
									</CommandGroup>
								)}
							</CommandList>
						</Command>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);
}
