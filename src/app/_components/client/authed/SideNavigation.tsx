"use client";

import { UserType } from "@prisma/client";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import {
	Building2,
	Calendar,
	CalendarClock,
	ChevronDown,
	LayoutDashboard,
	Mail,
	Settings,
	ShoppingCart,
	User,
	Users,
	Video,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	useSidebar,
} from "~/app/_components/shared/ui/sidebar";
import { api } from "~/trpc/react";
import FacilitySwitcherModal from "./FacilitySwitcherModal";

interface SideNavigationProps {
	user: { userType: UserType; clubShortName: string } | null | undefined;
	isLoading: boolean;
	collapsible?: "none" | "offcanvas" | "icon";
}

interface NavItem {
	label: string;
	href?: string;
	icon?: React.ReactNode;
	children?: NavItem[];
	userTypes: UserType[];
}

const ALL_TYPES: UserType[] = [
	UserType.STUDENT,
	UserType.COACH,
	UserType.FACILITY,
	UserType.CLUB_ADMIN,
	UserType.PLATFORM_ADMIN,
];

export const navItems: NavItem[] = [
	{
		label: "Dashboard",
		href: "/dashboard",
		icon: <LayoutDashboard size={20} />,
		userTypes: ALL_TYPES,
	},
	{
		label: "Calendar",
		href: "/calendar",
		icon: <Calendar size={20} />,
		userTypes: ALL_TYPES,
	},
	{
		label: "Book a Court",
		href: "/rentals",
		icon: <CalendarClock size={20} />,
		userTypes: ALL_TYPES,
	},
	{
		label: "Products",
		href: "/admin/products",
		icon: <ShoppingCart size={20} />,
		userTypes: [
			UserType.FACILITY,
			UserType.CLUB_ADMIN,
			UserType.PLATFORM_ADMIN,
		],
	},
	{
		label: "Clients",
		href: "/clients",
		icon: <Users size={20} />,
		userTypes: [
			UserType.FACILITY,
			UserType.CLUB_ADMIN,
			UserType.PLATFORM_ADMIN,
		],
	},
	{
		label: "Video Collections",
		href: "/video-collections",
		icon: <Video size={20} />,
		children: [
			{
				label: "My Collections",
				href: "/video-collections",
				userTypes: [
					UserType.STUDENT,
					UserType.FACILITY,
					UserType.CLUB_ADMIN,
					UserType.PLATFORM_ADMIN,
				],
			},
			{
				label: "Create New",
				href: "/video-collections/create",
				userTypes: [
					UserType.STUDENT,
					UserType.FACILITY,
					UserType.CLUB_ADMIN,
					UserType.PLATFORM_ADMIN,
				],
			},
		],
		userTypes: [
			UserType.STUDENT,
			UserType.FACILITY,
			UserType.CLUB_ADMIN,
			UserType.PLATFORM_ADMIN,
		],
	},
	{
		label: "Browse Coaches",
		href: "/coaches",
		icon: <Users size={20} />,
		userTypes: ALL_TYPES,
	},
	{
		label: "Email Groups",
		href: "/email-groups",
		icon: <Mail size={20} />,
		userTypes: [
			UserType.FACILITY,
			UserType.COACH,
			UserType.CLUB_ADMIN,
			UserType.PLATFORM_ADMIN,
		],
	},
	{
		label: "Profile",
		href: "/profile",
		icon: <User size={20} />,
		userTypes: ALL_TYPES,
	},
	{
		label: "Admin",
		href: "/admin",
		icon: <Settings size={20} />,
		children: [
			{
				label: "Facilities",
				href: "/admin/facilities",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
			},
			{
				label: "All Collections",
				href: "/admin/collections",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
			},
			{
				label: "Product Categories",
				href: "/admin/products/categories",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
			},
			{
				label: "Packages",
				href: "/admin/packages",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
			},
			{
				label: "Check-in",
				href: "/admin/checkin",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
			},
			{
				label: "Court Rentals",
				href: "/admin/rentals",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
			},
			{
				label: "Documents",
				href: "/admin#documents",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
				children: [
					{
						label: "Document History",
						href: "/admin#document-history",
						userTypes: [
							UserType.PLATFORM_ADMIN,
							UserType.CLUB_ADMIN,
							UserType.FACILITY,
						],
					},
					{
						label: "Templates",
						href: "/admin#document-templates",
						userTypes: [
							UserType.PLATFORM_ADMIN,
							UserType.CLUB_ADMIN,
							UserType.FACILITY,
						],
					},
				],
			},
			{
				label: "Billing",
				href: "/admin#billing",
				userTypes: [
					UserType.PLATFORM_ADMIN,
					UserType.CLUB_ADMIN,
					UserType.FACILITY,
				],
				children: [
					{
						label: "Uninvoiced: User",
						href: "/admin#uninvoiced-user",
						userTypes: [
							UserType.PLATFORM_ADMIN,
							UserType.CLUB_ADMIN,
							UserType.FACILITY,
						],
					},
					{
						label: "Uninvoiced: Location",
						href: "/admin#uninvoiced-location",
						userTypes: [
							UserType.PLATFORM_ADMIN,
							UserType.CLUB_ADMIN,
							UserType.FACILITY,
						],
					},
					{
						label: "Review Post Billing",
						href: "/admin#review-post-billing",
						userTypes: [
							UserType.PLATFORM_ADMIN,
							UserType.CLUB_ADMIN,
							UserType.FACILITY,
						],
					},
				],
			},
			{
				label: "Database",
				href: "/database",
				userTypes: [UserType.PLATFORM_ADMIN],
			},
		],
		userTypes: [
			UserType.PLATFORM_ADMIN,
			UserType.CLUB_ADMIN,
			UserType.FACILITY,
		],
	},
];

function filterByUserType(items: NavItem[], userType: UserType): NavItem[] {
	return items.filter((item) => item.userTypes.includes(userType));
}

export default function SideNavigation({
	user,
	isLoading,
	collapsible = "offcanvas",
}: SideNavigationProps) {
	const pathname = usePathname();
	const router = useRouter();
	const { isMobile, setOpenMobile } = useSidebar();
	const handleLeafClick = isMobile ? () => setOpenMobile(false) : undefined;
	const [facilityModalOpen, setFacilityModalOpen] = useState(false);

	// Get active facility name for the switcher button
	const { data: facilityMemberships } =
		api.user.getFacilityMemberships.useQuery(undefined, { enabled: !!user });
	const activeFacility = facilityMemberships?.find((m) => m.isActive);

	return (
		<Sidebar
			collapsible={collapsible}
			className="h-full border-gray-200 border-r"
		>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						{isLoading ? (
							<div className="animate-pulse space-y-2 p-4">
								<div className="h-9 rounded bg-gray-200" />
								<div className="h-9 rounded bg-gray-200" />
								<div className="h-9 rounded bg-gray-200" />
							</div>
						) : user ? (
							<SidebarMenu>
								{filterByUserType(navItems, user.userType).map((item) => {
									const hasChildren = item.children && item.children.length > 0;
									const filteredChildren =
										hasChildren && item.children
											? filterByUserType(item.children, user.userType)
											: [];

									if (hasChildren && filteredChildren.length === 0) {
										return null;
									}

									if (hasChildren) {
										const isInSection = item.href
											? pathname === item.href ||
												pathname.startsWith(item.href + "/")
											: filteredChildren.some(
													(c) => c.href && pathname === c.href,
												);
										return (
											<Collapsible
												key={item.label}
												defaultOpen={isInSection}
												className="group/collapsible"
											>
												<SidebarMenuItem>
													<CollapsibleTrigger asChild>
														<SidebarMenuButton
															isActive={
																item.href ? pathname === item.href : false
															}
															onClick={() => {
																if (item.href) {
																	router.push(item.href);
																	handleLeafClick?.();
																}
															}}
														>
															{item.icon}
															<span>{item.label}</span>
															<ChevronDown
																size={16}
																className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180"
															/>
														</SidebarMenuButton>
													</CollapsibleTrigger>
													<CollapsibleContent>
														<SidebarMenuSub>
															{filteredChildren.map((child) => {
																const childChildren = child.children
																	? filterByUserType(
																			child.children,
																			user.userType,
																		)
																	: [];
																const hasNestedChildren =
																	childChildren.length > 0;

																if (hasNestedChildren) {
																	const nestedActive = childChildren.some(
																		(gc) =>
																			gc.href &&
																			pathname ===
																				(gc.href.split("#")[0] || gc.href),
																	);
																	return (
																		<Collapsible
																			key={child.label}
																			defaultOpen={
																				nestedActive ||
																				pathname ===
																					(child.href?.split("#")[0] ||
																						child.href)
																			}
																			className="group/nested"
																		>
																			<SidebarMenuSubItem>
																				<CollapsibleTrigger asChild>
																					<SidebarMenuSubButton
																						className="cursor-pointer"
																						isActive={
																							pathname ===
																							(child.href?.split("#")[0] ||
																								child.href)
																						}
																						onClick={() => {
																							if (child.href) {
																								router.push(child.href);
																								handleLeafClick?.();
																							}
																						}}
																					>
																						{child.label}
																						<ChevronDown
																							size={14}
																							className="ml-auto transition-transform group-data-[state=open]/nested:rotate-180"
																						/>
																					</SidebarMenuSubButton>
																				</CollapsibleTrigger>
																				<CollapsibleContent>
																					<SidebarMenuSub className="ml-2 border-gray-200 border-l">
																						{childChildren.map((gc) => (
																							<SidebarMenuSubItem
																								key={gc.label}
																							>
																								<SidebarMenuSubButton
																									asChild
																									className="text-xs"
																									isActive={
																										pathname ===
																										(gc.href?.split("#")[0] ||
																											gc.href)
																									}
																								>
																									<Link
																										href={gc.href ?? "#"}
																										onClick={handleLeafClick}
																									>
																										{gc.label}
																									</Link>
																								</SidebarMenuSubButton>
																							</SidebarMenuSubItem>
																						))}
																					</SidebarMenuSub>
																				</CollapsibleContent>
																			</SidebarMenuSubItem>
																		</Collapsible>
																	);
																}

																return (
																	<SidebarMenuSubItem key={child.label}>
																		<SidebarMenuSubButton
																			asChild
																			isActive={
																				pathname ===
																				(child.href?.split("#")[0] ||
																					child.href)
																			}
																		>
																			<Link
																				href={child.href ?? "#"}
																				onClick={handleLeafClick}
																			>
																				{child.label}
																			</Link>
																		</SidebarMenuSubButton>
																	</SidebarMenuSubItem>
																);
															})}
														</SidebarMenuSub>
													</CollapsibleContent>
												</SidebarMenuItem>
											</Collapsible>
										);
									}

									return (
										<SidebarMenuItem key={item.label}>
											<SidebarMenuButton
												asChild
												isActive={pathname === item.href}
											>
												<Link href={item.href ?? "#"} onClick={handleLeafClick}>
													{item.icon}
													<span>{item.label}</span>
												</Link>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						) : (
							<p className="px-4 py-4 text-center text-gray-500 text-sm">
								Unable to load navigation
							</p>
						)}
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			{/* Facility switcher at bottom of sidebar */}
			{user && (
				<SidebarFooter className="border-gray-200 border-t">
					<button
						onClick={() => setFacilityModalOpen(true)}
						className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-gray-700 text-sm transition-colors hover:bg-[var(--accent)]"
					>
						<Building2
							size={16}
							className="shrink-0 text-[var(--muted-foreground)]"
						/>
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-[var(--foreground)]">
								{activeFacility?.facilityName ?? "Select Facility"}
							</p>
							<p className="truncate text-[var(--muted-foreground)] text-xs">
								{user.clubShortName}
							</p>
						</div>
						<ChevronDown
							size={14}
							className="shrink-0 text-[var(--muted-foreground)]"
						/>
					</button>
				</SidebarFooter>
			)}

			<FacilitySwitcherModal
				open={facilityModalOpen}
				onOpenChange={setFacilityModalOpen}
			/>
		</Sidebar>
	);
}
