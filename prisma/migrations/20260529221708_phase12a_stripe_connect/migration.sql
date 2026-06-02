-- Phase 12a — Stripe Connect (foundation / Round 1).
-- See designFiles/roadmap/phase12-stripe-connect.md (canonical design) +
-- designFiles/roadmap/phase12a-build-plan.md §2 Stream 1.
--
-- Hand-edited (the schema changes generated interactive `@unique`-on-nullable
-- warnings that `prisma migrate dev` can't bypass in a non-interactive shell;
-- per Phase 12a doc those columns are guaranteed null in current data —
-- nothing populates them until Round 2 ships).

-- ============================================================
-- 1. New enums
-- ============================================================

-- CreateEnum
CREATE TYPE "OrphanedPurchaseStatus" AS ENUM ('PENDING', 'RECONCILED', 'REFUNDED', 'IGNORED');

-- ============================================================
-- 2. New tables (in dependency order)
-- ============================================================

-- CreateTable
CREATE TABLE "ClubStripeAccount" (
    "id" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "accountEmail" TEXT,
    "defaultCurrency" VARCHAR(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "ClubStripeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedProcessorEvent" (
    "processor" VARCHAR(30) NOT NULL,
    "eventId" VARCHAR(255) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedProcessorEvent_pkey" PRIMARY KEY ("processor","eventId")
);

-- CreateTable
CREATE TABLE "ProcessorCustomerLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processor" VARCHAR(30) NOT NULL,
    "providerAccountId" VARCHAR(255) NOT NULL,
    "providerCustomerId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessorCustomerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrphanedPurchase" (
    "id" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "processor" VARCHAR(30) NOT NULL,
    "providerSessionId" VARCHAR(255),
    "providerPaymentIntentId" VARCHAR(255),
    "email" TEXT,
    "reason" VARCHAR(60) NOT NULL,
    "status" "OrphanedPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "rawEvent" JSONB NOT NULL,
    "notes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrphanedPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "processor" VARCHAR(30) NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "amountInCents" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "intent" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "consumerUserId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 3. Indexes + unique constraints on new tables
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "ClubStripeAccount_clubShortName_key" ON "ClubStripeAccount"("clubShortName");

-- CreateIndex
CREATE UNIQUE INDEX "ClubStripeAccount_stripeAccountId_key" ON "ClubStripeAccount"("stripeAccountId");

-- CreateIndex
CREATE INDEX "ClubStripeAccount_stripeAccountId_idx" ON "ClubStripeAccount"("stripeAccountId");

-- CreateIndex
CREATE INDEX "ProcessedProcessorEvent_processedAt_idx" ON "ProcessedProcessorEvent"("processedAt");

-- CreateIndex
CREATE INDEX "ProcessorCustomerLink_providerAccountId_providerCustomerId_idx" ON "ProcessorCustomerLink"("providerAccountId", "providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessorCustomerLink_userId_processor_providerAccountId_key" ON "ProcessorCustomerLink"("userId", "processor", "providerAccountId");

-- CreateIndex
CREATE INDEX "OrphanedPurchase_clubShortName_status_idx" ON "OrphanedPurchase"("clubShortName", "status");

-- CreateIndex
CREATE INDEX "OrphanedPurchase_processor_providerSessionId_idx" ON "OrphanedPurchase"("processor", "providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_providerSessionId_key" ON "CheckoutSession"("providerSessionId");

-- CreateIndex
CREATE INDEX "CheckoutSession_clubShortName_status_idx" ON "CheckoutSession"("clubShortName", "status");

-- CreateIndex
CREATE INDEX "CheckoutSession_providerSessionId_idx" ON "CheckoutSession"("providerSessionId");

-- ============================================================
-- 4. New columns on existing tables (all nullable, no backfill needed)
-- ============================================================

-- AlterTable
ALTER TABLE "MemberPackage" ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "RentalBooking" ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "MemberMembership" ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "stripeCheckoutSessionId" TEXT;

-- ============================================================
-- 5. @unique constraints on existing + new Stripe ID columns
--    (safe — every targeted column is guaranteed null in current data per
--    HANDOFF schema-fact; nothing populates them until Round 2.)
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "PackagePlan_stripeProductId_key" ON "PackagePlan"("stripeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PackagePlan_stripePriceId_key" ON "PackagePlan"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_stripeCheckoutSessionId_key" ON "EventRegistration"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberPackage_stripeCheckoutSessionId_key" ON "MemberPackage"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "MemberPackage_stripePaymentIntentId_idx" ON "MemberPackage"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalBooking_stripeCheckoutSessionId_key" ON "RentalBooking"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "RentalBooking_stripePaymentIntentId_idx" ON "RentalBooking"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberMembership_stripeCheckoutSessionId_key" ON "MemberMembership"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "MemberMembership_stripePaymentIntentId_idx" ON "MemberMembership"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeCheckoutSessionId_key" ON "Invoice"("stripeCheckoutSessionId");

-- ============================================================
-- 6. Foreign keys on new tables
-- ============================================================

-- AddForeignKey
ALTER TABLE "ClubStripeAccount" ADD CONSTRAINT "ClubStripeAccount_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessorCustomerLink" ADD CONSTRAINT "ProcessorCustomerLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrphanedPurchase" ADD CONSTRAINT "OrphanedPurchase_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;
