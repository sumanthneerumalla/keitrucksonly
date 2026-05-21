-- Phase 9a line-item hardening.
-- Adds: kind (discriminator enum), revenueCategoryId (snapshot), creditFromUserId
-- (snapshot of the credit source's payer). `kind` is required, so we add it
-- nullable first, backfill existing rows, then set NOT NULL.

-- CreateEnum
CREATE TYPE "InvoiceLineItemKind" AS ENUM ('PACKAGE_SALE', 'CREDIT', 'PRODUCT_SALE', 'FEE', 'EVENT_REGISTRATION', 'RENTAL', 'MEMBERSHIP_FEE');

-- AlterTable: add columns (kind nullable for now)
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "creditFromUserId" TEXT,
ADD COLUMN     "kind" "InvoiceLineItemKind",
ADD COLUMN     "revenueCategoryId" TEXT;

-- Backfill `kind` by inferring from the existing provenance FKs. Today only
-- two producers exist (package sales + credit-carry-forward lines), so this is
-- exact; the CREATE/PRODUCT/FEE branches are forward-defensive.
UPDATE "InvoiceLineItem"
SET "kind" = CASE
  WHEN "creditFromInvoiceId" IS NOT NULL THEN 'CREDIT'::"InvoiceLineItemKind"
  WHEN "packagePlanId" IS NOT NULL THEN 'PACKAGE_SALE'::"InvoiceLineItemKind"
  WHEN "productId" IS NOT NULL THEN 'PRODUCT_SALE'::"InvoiceLineItemKind"
  ELSE 'FEE'::"InvoiceLineItemKind"
END;

-- Backfill `revenueCategoryId` from each line's product's CURRENT revenue
-- category. Accurate now because categories have not drifted yet (the whole
-- point of doing this while invoice volume is tiny).
UPDATE "InvoiceLineItem" li
SET "revenueCategoryId" = p."revenueCategoryId"
FROM "Product" p
WHERE li."productId" = p."productId"
  AND li."productId" IS NOT NULL;

-- Backfill `creditFromUserId` from the source invoice's payer
-- (COALESCE(billedToUserId, userId) = the effective payer / whose credit it is).
UPDATE "InvoiceLineItem" li
SET "creditFromUserId" = COALESCE(src."billedToUserId", src."userId")
FROM "Invoice" src
WHERE li."creditFromInvoiceId" = src."invoiceId"
  AND li."creditFromInvoiceId" IS NOT NULL;

-- Now that every row has a kind, enforce NOT NULL.
ALTER TABLE "InvoiceLineItem" ALTER COLUMN "kind" SET NOT NULL;

-- CreateIndex
CREATE INDEX "InvoiceLineItem_kind_idx" ON "InvoiceLineItem"("kind");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_revenueCategoryId_idx" ON "InvoiceLineItem"("revenueCategoryId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_creditFromUserId_idx" ON "InvoiceLineItem"("creditFromUserId");

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_revenueCategoryId_fkey" FOREIGN KEY ("revenueCategoryId") REFERENCES "RevenueCategory"("revenueCategoryId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_creditFromUserId_fkey" FOREIGN KEY ("creditFromUserId") REFERENCES "User"("userId") ON DELETE SET NULL ON UPDATE CASCADE;
