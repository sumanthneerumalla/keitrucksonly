-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "creditConsumedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "creditFromInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_closedAt_idx" ON "Invoice"("closedAt");

-- CreateIndex
CREATE INDEX "Invoice_creditConsumedAt_idx" ON "Invoice"("creditConsumedAt");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_creditFromInvoiceId_idx" ON "InvoiceLineItem"("creditFromInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "User"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_creditFromInvoiceId_fkey" FOREIGN KEY ("creditFromInvoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE SET NULL ON UPDATE CASCADE;
