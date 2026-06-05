"use client";

import { useState } from "react";
import Link from "next/link";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { api } from "~/trpc/react";
import {
	ArrowLeft,
	Bold,
	Italic,
	List,
	ListOrdered,
	Link as LinkIcon,
	Heading2,
	Send,
	TestTube,
	Eye,
	EyeOff,
} from "lucide-react";

interface Props {
	emailGroupId: string;
	userType: string;
	userId: string;
}

export default function ComposeEmailClient({
	emailGroupId,
	userType,
	userId,
}: Props) {
	const [subject, setSubject] = useState("");
	const [showPreview, setShowPreview] = useState(false);
	const [sendingTest, setSendingTest] = useState(false);
	const [sendingGroup, setSendingGroup] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);
	const [sendResult, setSendResult] = useState<{
		sentCount: number;
		failedCount: number;
		skippedCount: number;
	} | null>(null);

	const groupQuery = api.emailGroups.getById.useQuery({ emailGroupId });

	const sendTestMutation = api.emailSend.sendTest.useMutation();
	const sendToGroupMutation = api.emailSend.sendToGroup.useMutation();

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
				placeholder: "Write your email content here...",
			}),
		],
		content: "",
		editorProps: {
			attributes: {
				class: "prose prose-sm max-w-none min-h-[200px] p-4 focus:outline-none",
			},
		},
	});

	const getHtml = () => {
		if (!editor) return "";
		return editor.getHTML();
	};

	const handleSendTest = async () => {
		if (!subject.trim() || !editor) return;
		setSendingTest(true);
		setTestResult(null);
		try {
			const result = await sendTestMutation.mutateAsync({
				emailGroupId,
				subject,
				bodyHtml: getHtml(),
			});
			setTestResult(`Test email sent to ${result.sentTo}`);
		} catch (err: any) {
			setTestResult(`Error: ${err.message}`);
		} finally {
			setSendingTest(false);
		}
	};

	const handleSendToGroup = async () => {
		if (!subject.trim() || !editor) return;
		if (
			!confirm(
				`Send this email to all members of "${groupQuery.data?.name}"?`,
			)
		)
			return;

		setSendingGroup(true);
		setSendResult(null);
		try {
			const result = await sendToGroupMutation.mutateAsync({
				emailGroupId,
				subject,
				bodyHtml: getHtml(),
			});
			setSendResult({
				sentCount: result.sentCount,
				failedCount: result.failedCount,
				skippedCount: result.skippedCount,
			});
		} catch (err: any) {
			setSendResult(null);
		} finally {
			setSendingGroup(false);
		}
	};

	const addLink = () => {
		const url = prompt("Enter URL:");
		if (url && editor) {
			editor.chain().focus().setLink({ href: url }).run();
		}
	};

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6">
				<Link
					href={`/email-groups/${emailGroupId}`}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to {groupQuery.data?.name ?? "group"}
				</Link>
			</div>

			<h1 className="mb-6 text-2xl font-bold">Compose Email</h1>

			{/* Subject */}
			<div className="mb-4">
				<label className="mb-1.5 block text-sm font-medium">Subject</label>
				<input
					type="text"
					value={subject}
					onChange={(e) => setSubject(e.target.value)}
					placeholder="Email subject..."
					className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
					maxLength={500}
				/>
			</div>

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
				<ToolbarButton onClick={addLink} active={editor?.isActive("link")} title="Add Link">
					<LinkIcon className="h-4 w-4" />
				</ToolbarButton>
			</div>

			{/* Editor / Preview */}
			{showPreview ? (
				<div className="rounded-b-md border p-4">
					<div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
						Email Preview
					</div>
					<div className="rounded border bg-white p-6">
						<h2 className="mb-4 text-lg font-bold">{subject || "(No subject)"}</h2>
						<div
							className="prose prose-sm max-w-none"
							dangerouslySetInnerHTML={{ __html: getHtml() }}
						/>
					</div>
				</div>
			) : (
				<div className="rounded-b-md border">
					<EditorContent editor={editor} />
				</div>
			)}

			{/* Actions */}
			<div className="mt-6 flex flex-wrap items-center justify-between gap-3">
				<button
					type="button"
					onClick={() => setShowPreview(!showPreview)}
					className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent"
				>
					{showPreview ? (
						<>
							<EyeOff className="h-4 w-4" />
							Edit
						</>
					) : (
						<>
							<Eye className="h-4 w-4" />
							Preview
						</>
					)}
				</button>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleSendTest}
						disabled={sendingTest || !subject.trim()}
						className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
					>
						<TestTube className="h-4 w-4" />
						{sendingTest ? "Sending..." : "Send Test to Me"}
					</button>
					<button
						type="button"
						onClick={handleSendToGroup}
						disabled={sendingGroup || !subject.trim()}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						<Send className="h-4 w-4" />
						{sendingGroup
							? "Sending..."
							: `Send to Group (${groupQuery.data?.members.length ?? 0})`}
					</button>
				</div>
			</div>

			{/* Test result feedback */}
			{testResult && (
				<p
					className={`mt-3 text-sm ${
						testResult.startsWith("Error") ? "text-destructive" : "text-green-600"
					}`}
				>
					{testResult}
				</p>
			)}

			{sendToGroupMutation.error && (
				<p className="mt-3 text-sm text-destructive">
					{sendToGroupMutation.error.message}
				</p>
			)}

			{sendResult && (
				<div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
					<p className="mb-1 font-medium text-green-800">Email sent successfully</p>
					<div className="flex gap-4 text-sm text-green-700">
						<span>✓ {sendResult.sentCount} delivered</span>
						{sendResult.failedCount > 0 && (
							<span className="text-red-600">✗ {sendResult.failedCount} failed</span>
						)}
						{sendResult.skippedCount > 0 && (
							<span className="text-amber-600">⚠ {sendResult.skippedCount} skipped (no email)</span>
						)}
					</div>
					<a
						href={`/email-groups/${emailGroupId}`}
						className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-green-800 underline-offset-2 hover:underline"
					>
						View Send History →
					</a>
				</div>
			)}
		</div>
	);
}

function ToolbarButton({
	onClick,
	active,
	title,
	children,
}: {
	onClick: () => void;
	active?: boolean;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`rounded p-1.5 transition-colors ${
				active
					? "bg-primary/10 text-primary"
					: "text-muted-foreground hover:bg-accent hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}
