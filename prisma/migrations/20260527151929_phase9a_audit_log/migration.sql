-- CreateTable
CREATE TABLE "AuditLog" (
    "logId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "actorUserId" TEXT,
    "source" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetRole" TEXT,
    "correlationId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("logId")
);

-- CreateIndex
CREATE INDEX "AuditLog_clubShortName_targetUserId_createdAt_idx" ON "AuditLog"("clubShortName", "targetUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_clubShortName_createdAt_idx" ON "AuditLog"("clubShortName", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_clubShortName_entityType_entityId_idx" ON "AuditLog"("clubShortName", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_clubShortName_dedupeKey_key" ON "AuditLog"("clubShortName", "dedupeKey");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("userId") ON DELETE SET NULL ON UPDATE CASCADE;
