"use client";

import { History, Mail, Plus, RefreshCw, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

interface Props {
	userType: string;
	userId: string;
	clubShortName: string;
	activeFacilityId: string | null;
}

export default function EmailGroupsClient({
	userType,
	userId,
	clubShortName,
	activeFacilityId,
}: Props) {
	const [showCreateModal, setShowCreateModal] = useState(false);

	const myGroups = api.emailGroups.getMyGroups.useQuery();
	const allHistoryQuery = api.emailGroups.getAllSendHistory.useQuery(
		{ facilityId: activeFacilityId ?? "" },
		{ enabled: !!activeFacilityId },
	);
	const adminGroups = api.emailGroups.getAllForFacility.useQuery(
		{ facilityId: activeFacilityId ?? "" },
		{ enabled: isAnyAdmin({ userType }) && !!activeFacilityId },
	);

	const groups = isAnyAdmin({ userType }) ? adminGroups : myGroups;

	return (
		<div className="mx-auto max-w-4xl p-6">
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl">Email Groups</h1>
					<p className="text-muted-foreground text-sm">
						Create and manage email groups to communicate with facility members
					</p>
				</div>
				<Link
					href="/email-groups/new"
					className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" />
					New Group
				</Link>
			</div>

			{groups.isLoading && (
				<div className="flex items-center justify-center py-12">
					<RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			)}

			{groups.data && groups.data.length === 0 && (
				<div className="rounded-lg border border-dashed p-12 text-center">
					<Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No email groups yet</h3>
					<p className="mt-2 text-muted-foreground text-sm">
						Create your first email group to start communicating with facility
						members.
					</p>
					<Link
						href="/email-groups/new"
						className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
					>
						<Plus className="h-4 w-4" />
						Create Group
					</Link>
				</div>
			)}

			{groups.data && groups.data.length > 0 && (
				<div className="space-y-3">
					{groups.data.map((group: any) => (
						<Link
							key={group.emailGroupId}
							href={`/email-groups/${group.emailGroupId}`}
							className="block rounded-lg border p-4 transition-colors hover:bg-accent/50"
						>
							<div className="flex items-center justify-between">
								<div>
									<h3 className="font-medium">{group.name}</h3>
									<div className="mt-1 flex items-center gap-3 text-muted-foreground text-sm">
										<span className="flex items-center gap-1">
											<Users className="h-3.5 w-3.5" />
											{group._count?.members ?? 0} members
										</span>
										{group.facility && <span>{group.facility.name}</span>}
										{group.createdByUser && (
											<span>
												by {group.createdByUser.firstName}{" "}
												{group.createdByUser.lastName}
											</span>
										)}
									</div>
								</div>
								<Mail className="h-5 w-5 text-muted-foreground" />
							</div>
						</Link>
					))}
				</div>
			)}

			{/* Send History */}
			<div className="mt-8 rounded-lg border">
				<div className="border-b px-4 py-3">
					<h2 className="flex items-center gap-2 font-medium">
						<History className="h-4 w-4" />
						Send History
					</h2>
				</div>
				{allHistoryQuery.isLoading && (
					<div className="flex items-center justify-center py-8">
						<RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				)}
				{allHistoryQuery.data && allHistoryQuery.data.length === 0 && (
					<p className="px-4 py-8 text-center text-muted-foreground text-sm">
						No emails sent yet.
					</p>
				)}
				{allHistoryQuery.data && allHistoryQuery.data.length > 0 && (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b bg-accent/30 font-medium text-muted-foreground text-xs">
									<th className="px-4 py-2.5 text-left">Resend ID</th>
									<th className="px-4 py-2.5 text-left">Subject</th>
									<th className="px-4 py-2.5 text-left">Recipients</th>
									<th className="px-4 py-2.5 text-left">Status</th>
									<th className="px-4 py-2.5 text-left">Sent</th>
								</tr>
							</thead>
							<tbody>
								{allHistoryQuery.data.map((log: any) => (
									<tr
										key={log.sendLogId}
										className="border-b last:border-b-0 hover:bg-accent/20"
									>
										{/* Resend ID */}
										<td className="px-4 py-3">
											{log.resendId ? (
												<span
													title={log.resendId}
													className="font-mono text-muted-foreground text-xs"
												>
													{log.resendId.slice(0, 16)}…
												</span>
											) : (
												<span className="text-muted-foreground/50 text-xs">
													—
												</span>
											)}
										</td>
										{/* Subject */}
										<td className="px-4 py-3">
											<Link
												href={`/email-groups/${log.emailGroupId}`}
												className="font-medium hover:underline"
											>
												{log.subject}
											</Link>
										</td>
										{/* Group + counts */}
										<td className="px-4 py-3 text-muted-foreground">
											{log.emailGroup?.name ?? "—"}
											<span className="ml-1 text-xs">
												· {log.recipientCount} sent
												{log.skippedCount > 0 && (
													<span className="ml-1 text-amber-600">
														/ {log.skippedCount} skipped
													</span>
												)}
											</span>
										</td>
										{/* Status */}
										<td className="px-4 py-3">
											<div className="flex flex-wrap gap-1">
												{log.status === "sent" && (
													<span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 text-xs">
														sent
													</span>
												)}
												{log.status === "partial_failure" && (
													<span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 text-xs">
														partial
													</span>
												)}
												{log.status === "failed" && (
													<span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 text-xs">
														API rejected
													</span>
												)}
												{log.status === "sending" && (
													<span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 text-xs">
														sending
													</span>
												)}
												{!log.status && (
													<span className="rounded-full bg-accent px-2 py-0.5 text-muted-foreground text-xs">
														—
													</span>
												)}
												{(log._count?.recipients ?? 0) > 0 && (
													<span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-700 text-xs">
														{log._count.recipients} bounced
													</span>
												)}
											</div>
										</td>
										{/* Date */}
										<td className="whitespace-nowrap px-4 py-3 text-muted-foreground text-xs">
											{new Date(log.sentAt).toLocaleDateString(undefined, {
												day: "numeric",
												month: "short",
												year: "numeric",
											})}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
