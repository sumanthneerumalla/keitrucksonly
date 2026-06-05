-- AlterTable: EmailSendLog — flag test sends so they can be excluded from
-- the user-facing send history while still being logged for audit/tracking.
ALTER TABLE "EmailSendLog" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
