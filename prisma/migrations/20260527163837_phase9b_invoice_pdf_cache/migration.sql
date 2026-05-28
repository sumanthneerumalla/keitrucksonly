-- CreateTable
CREATE TABLE "InvoicePdf" (
    "invoicePdfId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "pdfData" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "rendererVersion" VARCHAR(30) NOT NULL,
    "invoiceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePdf_pkey" PRIMARY KEY ("invoicePdfId")
);

-- CreateIndex
CREATE INDEX "InvoicePdf_invoiceId_idx" ON "InvoicePdf"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePdf_generatedBy_idx" ON "InvoicePdf"("generatedBy");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePdf_invoiceId_version_key" ON "InvoicePdf"("invoiceId", "version");

-- AddForeignKey
ALTER TABLE "InvoicePdf" ADD CONSTRAINT "InvoicePdf_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePdf" ADD CONSTRAINT "InvoicePdf_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("userId") ON DELETE SET NULL ON UPDATE CASCADE;
