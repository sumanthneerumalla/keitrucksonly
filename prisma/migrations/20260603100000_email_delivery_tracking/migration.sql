-- AlterTable: EmailGroup — add soft-delete column
ALTER TABLE "EmailGroup" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "EmailGroup_archivedAt_idx" ON "EmailGroup"("archivedAt");

-- AlterTable: EmailSendLog — add status, body text, sender snapshot, skip tracking, error
ALTER TABLE "EmailSendLog" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'sent';
ALTER TABLE "EmailSendLog" ADD COLUMN "bodyText" TEXT;
ALTER TABLE "EmailSendLog" ADD COLUMN "replyToEmail" VARCHAR(255);
ALTER TABLE "EmailSendLog" ADD COLUMN "fromDisplayName" VARCHAR(200);
ALTER TABLE "EmailSendLog" ADD COLUMN "skippedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailSendLog" ADD COLUMN "skippedRecipients" JSONB;
ALTER TABLE "EmailSendLog" ADD COLUMN "errorMessage" TEXT;

-- AlterTable: EmailSendRecipient — add per-recipient Resend ID and delivery tracking columns
ALTER TABLE "EmailSendRecipient" ADD COLUMN "resendMessageId" VARCHAR(100);
ALTER TABLE "EmailSendRecipient" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "EmailSendRecipient" ADD COLUMN "openedAt" TIMESTAMP(3);
ALTER TABLE "EmailSendRecipient" ADD COLUMN "openCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailSendRecipient" ADD COLUMN "bouncedAt" TIMESTAMP(3);
ALTER TABLE "EmailSendRecipient" ADD COLUMN "complainedAt" TIMESTAMP(3);
ALTER TABLE "EmailSendRecipient" ADD COLUMN "error" TEXT;
CREATE INDEX "EmailSendRecipient_resendMessageId_idx" ON "EmailSendRecipient"("resendMessageId");
