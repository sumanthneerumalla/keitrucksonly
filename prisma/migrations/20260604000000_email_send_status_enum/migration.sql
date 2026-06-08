-- Convert EmailSendLog.status from VARCHAR(20) to a proper enum.
-- Existing rows hold lowercase values ('sending' | 'sent' | 'partial_failure'
-- | 'failed') that map 1:1 to the new enum labels, so the USING cast is safe.

-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('queued', 'sending', 'sent', 'partial_failure', 'failed');

-- AlterTable: drop the string default, cast the column, restore the default
ALTER TABLE "EmailSendLog" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "EmailSendLog" ALTER COLUMN "status" TYPE "EmailSendStatus" USING "status"::"EmailSendStatus";
ALTER TABLE "EmailSendLog" ALTER COLUMN "status" SET DEFAULT 'sent';
