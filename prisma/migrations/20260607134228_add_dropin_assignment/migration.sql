-- CreateEnum
CREATE TYPE "DropInSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "DropInAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'CONFIRMED', 'DISPUTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GbrSyncStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "DropInAssignment" (
    "assignmentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "format" "DropInFormat" NOT NULL,
    "status" "DropInAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reportedByUserId" TEXT,
    "reportedScoreA" INTEGER,
    "reportedScoreB" INTEGER,
    "gameScores" JSONB,
    "winnerSide" "DropInSide",
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "externalMatchId" TEXT,
    "gbrSyncStatus" "GbrSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "gbrSyncedAt" TIMESTAMP(3),
    "gbrSyncError" TEXT,
    "ratingWeight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropInAssignment_pkey" PRIMARY KEY ("assignmentId")
);

-- CreateTable
CREATE TABLE "DropInAssignmentParticipant" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gbrPlayerId" TEXT,
    "side" "DropInSide",
    "isWinner" BOOLEAN,
    "ratingAtAssignment" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DropInAssignmentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DropInAssignment_externalMatchId_key" ON "DropInAssignment"("externalMatchId");

-- CreateIndex
CREATE INDEX "DropInAssignment_sessionId_status_idx" ON "DropInAssignment"("sessionId", "status");

-- CreateIndex
CREATE INDEX "DropInAssignment_courtId_idx" ON "DropInAssignment"("courtId");

-- CreateIndex
CREATE INDEX "DropInAssignment_gbrSyncStatus_idx" ON "DropInAssignment"("gbrSyncStatus");

-- CreateIndex
CREATE INDEX "DropInAssignmentParticipant_sessionId_userId_idx" ON "DropInAssignmentParticipant"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "DropInAssignmentParticipant_userId_idx" ON "DropInAssignmentParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DropInAssignmentParticipant_assignmentId_userId_key" ON "DropInAssignmentParticipant"("assignmentId", "userId");

-- AddForeignKey
ALTER TABLE "DropInAssignment" ADD CONSTRAINT "DropInAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DropInSession"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropInAssignmentParticipant" ADD CONSTRAINT "DropInAssignmentParticipant_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DropInAssignment"("assignmentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropInAssignmentParticipant" ADD CONSTRAINT "DropInAssignmentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
