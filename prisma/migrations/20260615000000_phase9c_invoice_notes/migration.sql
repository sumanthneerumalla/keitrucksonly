-- Phase 9c §6: InvoiceNote (staff-attributed, soft-deletable note rows) replaces
-- the legacy single Invoice.notes text blob. The 3 throwaway dev rows are
-- disposable (owner-confirmed); void reasons that lived in the blob also live in
-- the AuditLog, so nothing of value is lost. No data migration, no fallback.

-- DropColumn
ALTER TABLE "Invoice" DROP COLUMN "notes";

-- CreateTable
CREATE TABLE "InvoiceNote" (
    "invoiceNoteId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "body" TEXT NOT NULL,
    "showOnInvoice" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceNote_pkey" PRIMARY KEY ("invoiceNoteId")
);

-- CreateIndex
CREATE INDEX "InvoiceNote_invoiceId_idx" ON "InvoiceNote"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceNote_clubShortName_idx" ON "InvoiceNote"("clubShortName");

-- AddForeignKey
ALTER TABLE "InvoiceNote" ADD CONSTRAINT "InvoiceNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceNote" ADD CONSTRAINT "InvoiceNote_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "InvoiceLineItem"("lineItemId") ON DELETE SET NULL ON UPDATE CASCADE;
