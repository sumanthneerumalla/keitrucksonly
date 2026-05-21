-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billedToUserId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_billedToUserId_idx" ON "Invoice"("billedToUserId");

-- CreateIndex
CREATE INDEX "Invoice_clubShortName_billedToUserId_idx" ON "Invoice"("clubShortName", "billedToUserId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billedToUserId_fkey" FOREIGN KEY ("billedToUserId") REFERENCES "User"("userId") ON DELETE SET NULL ON UPDATE CASCADE;
