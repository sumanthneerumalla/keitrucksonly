-- Phase 12a Round 3.6 — InvoiceLineItem.creditFromPaymentId
--
-- Adds a column linking a refund-as-credit CREDIT line back to the
-- InvoicePayment that funded it. Powers the refund cap math in
-- `payments.refundStripePayment` and `billing.recordRefund` so that
-- account credit issued against a payment counts against the refundable
-- balance — preventing the double-issue case where an admin issues a
-- $50 credit on a $100 payment and then refunds the full $100 to the
-- card ($150 returned against $100 paid).
--
-- NULL for auto-carry-forward CREDIT lines (creditFromInvoiceId is the
-- provenance there); set only by `issueAccountCreditFromPayment`.
--
-- No backfill required — pre-existing CREDIT rows are all
-- auto-carry-forward and stay NULL on this column.

-- 1. Add nullable column
ALTER TABLE "InvoiceLineItem"
    ADD COLUMN "creditFromPaymentId" TEXT;

-- 2. FK with SetNull on payment delete (mirrors the SetNull semantics on
-- creditFromUserId — preserve the financial line if the payment row is
-- ever removed).
ALTER TABLE "InvoiceLineItem"
    ADD CONSTRAINT "InvoiceLineItem_creditFromPaymentId_fkey"
    FOREIGN KEY ("creditFromPaymentId") REFERENCES "InvoicePayment"("paymentId")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Index for the cap-math aggregate
-- (where creditFromPaymentId = ? AND kind = 'CREDIT')
CREATE INDEX "InvoiceLineItem_creditFromPaymentId_idx"
    ON "InvoiceLineItem"("creditFromPaymentId");
