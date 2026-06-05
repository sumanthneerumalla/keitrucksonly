-- CreateEnum
CREATE TYPE "DropInMode" AS ENUM ('TIMED', 'MATCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "DropInSessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DropInFormat" AS ENUM ('SINGLES', 'DOUBLES', 'MIXED');

-- CreateEnum
CREATE TYPE "DropInPlayerStatus" AS ENUM ('IDLE', 'WAITING', 'PLAYING', 'AWAITING_RESULT', 'DONE', 'LEFT', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'DROP_IN';

-- CreateTable
CREATE TABLE "DropInSession" (
    "sessionId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "mode" "DropInMode" NOT NULL,
    "format" "DropInFormat",
    "status" "DropInSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "courtIds" TEXT[],
    "rotationMinutes" INTEGER,
    "matchTimeLimitMinutes" INTEGER,
    "bestOf" INTEGER DEFAULT 3,
    "pointsPerGame" INTEGER DEFAULT 21,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropInSession_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "DropInCheckIn" (
    "checkInId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DropInPlayerStatus" NOT NULL DEFAULT 'IDLE',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "gbrPlayerId" TEXT,
    "registrationId" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropInCheckIn_pkey" PRIMARY KEY ("checkInId")
);

-- CreateIndex
CREATE INDEX "DropInSession_clubShortName_idx" ON "DropInSession"("clubShortName");

-- CreateIndex
CREATE INDEX "DropInSession_status_idx" ON "DropInSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DropInSession_eventId_occurrenceDate_key" ON "DropInSession"("eventId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "DropInCheckIn_sessionId_status_idx" ON "DropInCheckIn"("sessionId", "status");

-- CreateIndex
CREATE INDEX "DropInCheckIn_userId_idx" ON "DropInCheckIn"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DropInCheckIn_sessionId_userId_key" ON "DropInCheckIn"("sessionId", "userId");

-- AddForeignKey
ALTER TABLE "DropInSession" ADD CONSTRAINT "DropInSession_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropInSession" ADD CONSTRAINT "DropInSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropInCheckIn" ADD CONSTRAINT "DropInCheckIn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DropInSession"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropInCheckIn" ADD CONSTRAINT "DropInCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
