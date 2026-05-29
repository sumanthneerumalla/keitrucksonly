-- AlterTable
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "eventRegistrationId" TEXT;

-- CreateIndex
CREATE INDEX "InvoiceLineItem_eventRegistrationId_idx" ON "InvoiceLineItem"("eventRegistrationId");

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_eventRegistrationId_fkey" FOREIGN KEY ("eventRegistrationId") REFERENCES "EventRegistration"("registrationId") ON DELETE SET NULL ON UPDATE CASCADE;
