-- Switch the invoice-PDF cache from a per-field updatedAt watermark to a
-- content hash of the assembled DTO. contentHash is nullable so existing cached
-- rows (which used invoiceUpdatedAt) regenerate once on next read.
ALTER TABLE "InvoicePdf" ADD COLUMN "contentHash" VARCHAR(64);
ALTER TABLE "InvoicePdf" DROP COLUMN "invoiceUpdatedAt";
