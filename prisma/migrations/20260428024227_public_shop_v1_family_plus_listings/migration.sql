-- AlterTable
ALTER TABLE "PackagePlan" ADD COLUMN     "isPubliclyListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publicImageData" BYTEA,
ADD COLUMN     "publicImageType" TEXT,
ADD COLUMN     "stripePriceId" TEXT,
ADD COLUMN     "stripeProductId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isPubliclyListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publicImageData" BYTEA,
ADD COLUMN     "publicImageType" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "familyGroupId" TEXT;

-- CreateTable
CREATE TABLE "FamilyGroup" (
    "familyGroupId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyGroup_pkey" PRIMARY KEY ("familyGroupId")
);

-- CreateIndex
CREATE INDEX "FamilyGroup_clubShortName_idx" ON "FamilyGroup"("clubShortName");

-- CreateIndex
CREATE INDEX "PackagePlan_clubShortName_isPubliclyListed_idx" ON "PackagePlan"("clubShortName", "isPubliclyListed");

-- CreateIndex
CREATE INDEX "Product_clubShortName_isPubliclyListed_idx" ON "Product"("clubShortName", "isPubliclyListed");

-- CreateIndex
CREATE INDEX "User_familyGroupId_idx" ON "User"("familyGroupId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("familyGroupId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyGroup" ADD CONSTRAINT "FamilyGroup_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;
