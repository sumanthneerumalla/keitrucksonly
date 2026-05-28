-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "membershipPreferences" JSONB;

-- AlterTable
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "memberMembershipId" TEXT,
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MembershipType" (
    "membershipTypeId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "revenueCategoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipType_pkey" PRIMARY KEY ("membershipTypeId")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "membershipPlanId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "membershipTypeId" TEXT NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "billingFrequency" VARCHAR(20) NOT NULL,
    "billingInterval" INTEGER NOT NULL,
    "billingUnit" VARCHAR(20) NOT NULL,
    "billingCycles" INTEGER,
    "feePerTermInCents" INTEGER NOT NULL,
    "initiationFeeInCents" INTEGER NOT NULL DEFAULT 0,
    "maxVisits" INTEGER,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "sellOnline" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("membershipPlanId")
);

-- CreateTable
CREATE TABLE "MemberMembership" (
    "memberMembershipId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipPlanId" TEXT NOT NULL,
    "facilityId" TEXT,
    "membershipNumber" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN,
    "billingCyclesCompleted" INTEGER NOT NULL DEFAULT 0,
    "freezeStartDate" TIMESTAMP(3),
    "freezeEndDate" TIMESTAMP(3),
    "freezeReason" TEXT,
    "suspendReason" TEXT,
    "cancelReason" TEXT,
    "cancelDate" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "soldBy" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberMembership_pkey" PRIMARY KEY ("memberMembershipId")
);

-- CreateIndex
CREATE INDEX "MembershipType_clubShortName_idx" ON "MembershipType"("clubShortName");

-- CreateIndex
CREATE INDEX "MembershipType_revenueCategoryId_idx" ON "MembershipType"("revenueCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipType_clubShortName_name_key" ON "MembershipType"("clubShortName", "name");

-- CreateIndex
CREATE INDEX "MembershipPlan_clubShortName_idx" ON "MembershipPlan"("clubShortName");

-- CreateIndex
CREATE INDEX "MembershipPlan_membershipTypeId_idx" ON "MembershipPlan"("membershipTypeId");

-- CreateIndex
CREATE INDEX "MemberMembership_clubShortName_idx" ON "MemberMembership"("clubShortName");

-- CreateIndex
CREATE INDEX "MemberMembership_userId_idx" ON "MemberMembership"("userId");

-- CreateIndex
CREATE INDEX "MemberMembership_membershipPlanId_idx" ON "MemberMembership"("membershipPlanId");

-- CreateIndex
CREATE INDEX "MemberMembership_facilityId_idx" ON "MemberMembership"("facilityId");

-- CreateIndex
CREATE INDEX "MemberMembership_status_idx" ON "MemberMembership"("status");

-- CreateIndex
CREATE INDEX "MemberMembership_endDate_idx" ON "MemberMembership"("endDate");

-- CreateIndex
CREATE INDEX "MemberMembership_soldBy_idx" ON "MemberMembership"("soldBy");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_memberMembershipId_idx" ON "InvoiceLineItem"("memberMembershipId");

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_memberMembershipId_fkey" FOREIGN KEY ("memberMembershipId") REFERENCES "MemberMembership"("memberMembershipId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipType" ADD CONSTRAINT "MembershipType_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipType" ADD CONSTRAINT "MembershipType_revenueCategoryId_fkey" FOREIGN KEY ("revenueCategoryId") REFERENCES "RevenueCategory"("revenueCategoryId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_membershipTypeId_fkey" FOREIGN KEY ("membershipTypeId") REFERENCES "MembershipType"("membershipTypeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("membershipPlanId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ClubFacility"("facilityId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_soldBy_fkey" FOREIGN KEY ("soldBy") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
