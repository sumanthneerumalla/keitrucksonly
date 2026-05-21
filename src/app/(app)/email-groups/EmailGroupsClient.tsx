"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { isAnyAdmin } from "~/lib/utils";
import Link from "next/link";
import { Plus, Users, Mail, RefreshCw } from "lucide-react";

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
	const adminGroups = api.emailGroups.getAllForFacility.useQuery(
		{ facilityId: activeFacilityId ?? "" },
		{ enabled: isAnyAdmin({ userType }) && !!activeFacilityId },
	);

	const groups = isAnyAdmin({ userType }) ? adminGroups : myGroups;

	return (
		<div className="mx-auto max-w-4xl p-6">
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Email Groups</h1>
					<p className="text-sm text-muted-foreground">
						Create and manage email groups to communicate with facility members
					</p>
				</div>
				<Link
					href="/email-groups/new"
					className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
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
					<h3 className="mt-4 text-lg font-medium">No email groups yet</h3>
					<p className="mt-2 text-sm text-muted-foreground">
						Create your first email group to start communicating with facility members.
					</p>
					<Link
						href="/email-groups/new"
						className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
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
									<div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
										<span className="flex items-center gap-1">
											<Users className="h-3.5 w-3.5" />
											{group._count?.members ?? 0} members
										</span>
										{group.facility && (
											<span>{group.facility.name}</span>
										)}
										{group.createdByUser && (
											<span>
												by {group.createdByUser.firstName} {group.createdByUser.lastName}
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
		</div>
	);
}
