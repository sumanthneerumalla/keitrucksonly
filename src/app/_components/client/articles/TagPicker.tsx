"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "~/trpc/react";

interface TagPickerProps {
	value: string[];
	onChange: (tagIds: string[]) => void;
	/**
	 * Phase 15 Stage 2 — article's scope. null = platform; string = that club.
	 * Tags are per-scope (Q5: per-club taxonomy, no cross-club pool), so the
	 * picker queries / creates tags within this scope.
	 *
	 * When this prop changes (only happens for PLATFORM_ADMIN on new posts
	 * via the Scope dropdown), the current selection is cleared because the
	 * existing tagIds belong to the old scope.
	 */
	clubShortName: string | null;
}

export default function TagPicker({
	value,
	onChange,
	clubShortName,
}: TagPickerProps) {
	const utils = api.useUtils();
	const tagsQuery = api.articles.adminListTags.useQuery({ clubShortName });
	const createTagMutation = api.articles.adminCreateTag.useMutation({
		onSuccess: () => {
			void utils.articles.adminListTags.invalidate();
		},
	});

	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Clear selection when scope changes. Use a ref to skip the initial mount
	// (don't wipe a pre-loaded set of tagIds the editor passed in).
	const prevScopeRef = useRef<string | null>(clubShortName);
	useEffect(() => {
		if (prevScopeRef.current !== clubShortName) {
			prevScopeRef.current = clubShortName;
			if (value.length > 0) {
				onChange([]);
			}
		}
	}, [clubShortName, value, onChange]);

	const tags = tagsQuery.data ?? [];

	const selectedTags = useMemo(
		() => tags.filter((t) => value.includes(t.id)),
		[tags, value],
	);

	const trimmedSearch = search.trim();
	const lowerSearch = trimmedSearch.toLowerCase();

	const filteredTags = useMemo(() => {
		if (!lowerSearch) {
			return tags.filter((t) => !value.includes(t.id)).slice(0, 20);
		}
		return tags
			.filter(
				(t) =>
					!value.includes(t.id) && t.name.toLowerCase().includes(lowerSearch),
			)
			.slice(0, 20);
	}, [tags, value, lowerSearch]);

	const exactMatch = useMemo(
		() =>
			trimmedSearch.length > 0 &&
			tags.some((t) => t.name.toLowerCase() === lowerSearch),
		[tags, trimmedSearch, lowerSearch],
	);

	const addTag = (tagId: string) => {
		if (!value.includes(tagId)) {
			onChange([...value, tagId]);
		}
		setSearch("");
		setError(null);
	};

	const removeTag = (tagId: string) => {
		onChange(value.filter((id) => id !== tagId));
	};

	const createTag = async () => {
		if (!trimmedSearch || exactMatch) return;
		setError(null);
		try {
			const tag = await createTagMutation.mutateAsync({
				name: trimmedSearch,
				clubShortName,
			});
			addTag(tag.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create tag");
		}
	};

	const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (!trimmedSearch) return;
			// Pick a single visible match if there's one
			const exact = tags.find(
				(t) => t.name.toLowerCase() === lowerSearch && !value.includes(t.id),
			);
			if (exact) {
				addTag(exact.id);
				return;
			}
			if (filteredTags.length === 1 && filteredTags[0]) {
				addTag(filteredTags[0].id);
				return;
			}
			// Otherwise create
			await createTag();
		} else if (e.key === "Backspace" && !search && selectedTags.length > 0) {
			const last = selectedTags[selectedTags.length - 1];
			if (last) removeTag(last.id);
		}
	};

	return (
		<div>
			<div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5">
				{selectedTags.map((tag) => (
					<span
						key={tag.id}
						className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs"
					>
						{tag.name}
						<button
							type="button"
							onClick={() => removeTag(tag.id)}
							className="-mr-1 rounded-full p-0.5 hover:bg-primary/20"
							title={`Remove ${tag.name}`}
						>
							<X className="h-3 w-3" />
						</button>
					</span>
				))}
				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={
						selectedTags.length === 0 ? "Add tags…" : "Add another tag…"
					}
					className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none"
					maxLength={100}
				/>
			</div>

			{/* Suggestions */}
			{(filteredTags.length > 0 ||
				(trimmedSearch && !exactMatch) ||
				tagsQuery.isLoading) && (
				<div className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-background text-sm shadow-sm">
					{tagsQuery.isLoading && (
						<div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
							<Loader2 className="h-3 w-3 animate-spin" />
							Loading tags…
						</div>
					)}
					{filteredTags.map((tag) => (
						<button
							key={tag.id}
							type="button"
							onClick={() => addTag(tag.id)}
							className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent"
						>
							<span>{tag.name}</span>
							<span className="text-muted-foreground text-xs">
								{tag.articleCount}
							</span>
						</button>
					))}
					{trimmedSearch && !exactMatch && (
						<button
							type="button"
							onClick={() => void createTag()}
							disabled={createTagMutation.isPending}
							className="flex w-full items-center gap-1.5 border-t px-3 py-1.5 text-left text-primary hover:bg-accent disabled:opacity-50"
						>
							{createTagMutation.isPending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Plus className="h-3 w-3" />
							)}
							Create "{trimmedSearch}"
						</button>
					)}
				</div>
			)}

			{error && <p className="mt-1 text-destructive text-sm">{error}</p>}
		</div>
	);
}
