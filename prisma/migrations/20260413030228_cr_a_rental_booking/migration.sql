-- CreateTable
CREATE TABLE "RentalBooking" (
    "bookingId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "rentalWindowEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "blockingEventId" TEXT,
    "productId" TEXT,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalBooking_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalBooking_blockingEventId_key" ON "RentalBooking"("blockingEventId");

-- CreateIndex
CREATE INDEX "RentalBooking_clubShortName_idx" ON "RentalBooking"("clubShortName");

-- CreateIndex
CREATE INDEX "RentalBooking_rentalWindowEventId_idx" ON "RentalBooking"("rentalWindowEventId");

-- CreateIndex
CREATE INDEX "RentalBooking_userId_idx" ON "RentalBooking"("userId");

-- CreateIndex
CREATE INDEX "RentalBooking_resourceId_idx" ON "RentalBooking"("resourceId");

-- CreateIndex
CREATE INDEX "RentalBooking_startTime_endTime_idx" ON "RentalBooking"("startTime", "endTime");

-- CreateIndex
CREATE INDEX "RentalBooking_status_idx" ON "RentalBooking"("status");

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ClubFacility"("facilityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_rentalWindowEventId_fkey" FOREIGN KEY ("rentalWindowEventId") REFERENCES "CalendarEvent"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ClubResource"("resourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_blockingEventId_fkey" FOREIGN KEY ("blockingEventId") REFERENCES "CalendarEvent"("eventId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("productId") ON DELETE SET NULL ON UPDATE CASCADE;
