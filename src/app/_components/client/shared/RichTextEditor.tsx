"use client";

import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	Bold,
	Heading2,
	ImagePlus,
	Italic,
	Link as LinkIcon,
	List,
	ListOrdered,
	Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";

interface RichTextEditorProps {
	value: string;
	onChange: (html: string) => void;
	placeholder?: string;
	minHeightPx?: number;
}

export default function RichTextEditor({
	value,
	onChange,
	placeholder,
	minHeightPx = 200,
}: RichTextEditorProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);

	// Phase 15 Step 6 — refactored from api.articles.uploadImage to the shared
	// contentImage router (articles AND announcements both call this).
	const uploadImageMutation = api.contentImage.upload.useMutation();

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
			}),
			LinkExtension.configure({
				openOnClick: false,
				HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
			}),
			ImageExtension,
			Placeholder.configure({
				placeholder: placeholder ?? "Write here…",
			}),
		],
		content: value,
		editorProps: {
			attributes: {
				class: "prose prose-sm max-w-none p-4 focus:outline-none",
				style: `min-height: ${minHeightPx}px;`,
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
		// Avoid SSR hydration warnings: TipTap mutates the DOM after mount.
		immediatelyRender: false,
	});

	// External value changes (e.g. loading an existing post) should update the
	// editor without echoing back through onChange and looping.
	useEffect(() => {
		if (!editor) return;
		if (value !== editor.getHTML()) {
			editor.commands.setContent(value, { emitUpdate: false });
		}
	}, [editor, value]);

	const addLink = () => {
		if (!editor) return;
		const url = prompt("Enter URL:");
		if (url) {
			editor.chain().focus().setLink({ href: url }).run();
		}
	};

	const handleImageButton = () => {
		setUploadError(null);
		fileInputRef.current?.click();
	};

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		// Reset the input so the same file can be picked again later.
		if (e.target) e.target.value = "";
		if (!file || !editor) return;

		setUploading(true);
		setUploadError(null);
		try {
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});

			// Strip the `data:<mime>;base64,` prefix.
			const commaIdx = dataUrl.indexOf(",");
			const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

			const result = await uploadImageMutation.mutateAsync({
				base64,
				mimeType: file.type,
				alt: "",
			});

			editor.chain().focus().setImage({ src: result.url }).run();
		} catch (err) {
			setUploadError(
				err instanceof Error ? err.message : "Failed to upload image",
			);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div>
			{/* Toolbar */}
			<div className="mb-0 flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 bg-accent/30 px-2 py-1.5">
				<ToolbarButton
					onClick={() => editor?.chain().focus().toggleBold().run()}
					active={editor?.isActive("bold")}
					title="Bold"
				>
					<Bold className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor?.chain().focus().toggleItalic().run()}
					active={editor?.isActive("italic")}
					title="Italic"
				>
					<Italic className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() =>
						editor?.chain().focus().toggleHeading({ level: 2 }).run()
					}
					active={editor?.isActive("heading", { level: 2 })}
					title="Heading"
				>
					<Heading2 className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor?.chain().focus().toggleBulletList().run()}
					active={editor?.isActive("bulletList")}
					title="Bullet List"
				>
					<List className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor?.chain().focus().toggleOrderedList().run()}
					active={editor?.isActive("orderedList")}
					title="Numbered List"
				>
					<ListOrdered className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					onClick={addLink}
					active={editor?.isActive("link")}
					title="Add Link"
				>
					<LinkIcon className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					onClick={handleImageButton}
					disabled={uploading}
					title="Insert Image"
				>
					{uploading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<ImagePlus className="h-4 w-4" />
					)}
				</ToolbarButton>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					hidden
					onChange={handleFileChange}
				/>
			</div>

			{/* Editor surface */}
			<div className="rounded-b-md border">
				<EditorContent editor={editor} />
			</div>

			{uploadError && (
				<p className="mt-2 text-destructive text-sm">{uploadError}</p>
			)}
		</div>
	);
}

function ToolbarButton({
	onClick,
	active,
	disabled,
	title,
	children,
}: {
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`rounded p-1.5 transition-colors disabled:opacity-50 ${
				active
					? "bg-primary/10 text-primary"
					: "text-muted-foreground hover:bg-accent hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}
