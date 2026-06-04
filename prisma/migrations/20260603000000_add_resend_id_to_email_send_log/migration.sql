-- AlterTable: EmailSendLog — add resendId to store the first Resend email ID from a batch send
ALTER TABLE "EmailSendLog" ADD COLUMN "resendId" VARCHAR(100);
