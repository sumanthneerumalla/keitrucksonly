-- AlterTable: add dateOfBirth to User
ALTER TABLE "User" ADD COLUMN "dateOfBirth" TIMESTAMP(3);

-- CreateTable: EmailGroup
CREATE TABLE "EmailGroup" (
    "emailGroupId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "filterConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailGroup_pkey" PRIMARY KEY ("emailGroupId")
);

-- CreateTable: EmailGroupMember
CREATE TABLE "EmailGroupMember" (
    "id" TEXT NOT NULL,
    "emailGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmailGroupExclusion
CREATE TABLE "EmailGroupExclusion" (
    "id" TEXT NOT NULL,
    "emailGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "excludedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailGroupExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmailSendLog
CREATE TABLE "EmailSendLog" (
    "sendLogId" TEXT NOT NULL,
    "emailGroupId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "attachmentUrls" TEXT[],
    "recipientCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSendLog_pkey" PRIMARY KEY ("sendLogId")
);

-- CreateTable: EmailSendRecipient
CREATE TABLE "EmailSendRecipient" (
    "id" TEXT NOT NULL,
    "sendLogId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL,

    CONSTRAINT "EmailSendRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: EmailGroup
CREATE INDEX "EmailGroup_clubShortName_idx" ON "EmailGroup"("clubShortName");
CREATE INDEX "EmailGroup_facilityId_idx" ON "EmailGroup"("facilityId");
CREATE INDEX "EmailGroup_createdByUserId_idx" ON "EmailGroup"("createdByUserId");

-- CreateIndex: EmailGroupMember
CREATE UNIQUE INDEX "EmailGroupMember_emailGroupId_userId_key" ON "EmailGroupMember"("emailGroupId", "userId");
CREATE INDEX "EmailGroupMember_emailGroupId_idx" ON "EmailGroupMember"("emailGroupId");
CREATE INDEX "EmailGroupMember_userId_idx" ON "EmailGroupMember"("userId");

-- CreateIndex: EmailGroupExclusion
CREATE UNIQUE INDEX "EmailGroupExclusion_emailGroupId_userId_key" ON "EmailGroupExclusion"("emailGroupId", "userId");
CREATE INDEX "EmailGroupExclusion_emailGroupId_idx" ON "EmailGroupExclusion"("emailGroupId");
CREATE INDEX "EmailGroupExclusion_userId_idx" ON "EmailGroupExclusion"("userId");

-- CreateIndex: EmailSendLog
CREATE INDEX "EmailSendLog_emailGroupId_idx" ON "EmailSendLog"("emailGroupId");
CREATE INDEX "EmailSendLog_senderUserId_idx" ON "EmailSendLog"("senderUserId");
CREATE INDEX "EmailSendLog_sentAt_idx" ON "EmailSendLog"("sentAt");

-- CreateIndex: EmailSendRecipient
CREATE INDEX "EmailSendRecipient_sendLogId_idx" ON "EmailSendRecipient"("sendLogId");
CREATE INDEX "EmailSendRecipient_userId_idx" ON "EmailSendRecipient"("userId");

-- AddForeignKey: EmailGroup
ALTER TABLE "EmailGroup" ADD CONSTRAINT "EmailGroup_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailGroup" ADD CONSTRAINT "EmailGroup_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ClubFacility"("facilityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailGroup" ADD CONSTRAINT "EmailGroup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: EmailGroupMember
ALTER TABLE "EmailGroupMember" ADD CONSTRAINT "EmailGroupMember_emailGroupId_fkey" FOREIGN KEY ("emailGroupId") REFERENCES "EmailGroup"("emailGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailGroupMember" ADD CONSTRAINT "EmailGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: EmailGroupExclusion
ALTER TABLE "EmailGroupExclusion" ADD CONSTRAINT "EmailGroupExclusion_emailGroupId_fkey" FOREIGN KEY ("emailGroupId") REFERENCES "EmailGroup"("emailGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailGroupExclusion" ADD CONSTRAINT "EmailGroupExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: EmailSendLog
ALTER TABLE "EmailSendLog" ADD CONSTRAINT "EmailSendLog_emailGroupId_fkey" FOREIGN KEY ("emailGroupId") REFERENCES "EmailGroup"("emailGroupId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailSendLog" ADD CONSTRAINT "EmailSendLog_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: EmailSendRecipient
ALTER TABLE "EmailSendRecipient" ADD CONSTRAINT "EmailSendRecipient_sendLogId_fkey" FOREIGN KEY ("sendLogId") REFERENCES "EmailSendLog"("sendLogId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailSendRecipient" ADD CONSTRAINT "EmailSendRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
