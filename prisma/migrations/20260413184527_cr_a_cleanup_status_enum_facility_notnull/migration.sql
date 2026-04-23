/*
  Warnings:

  - The `status` column on the `RentalBooking` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `facilityId` on table `CalendarEvent` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "RentalBookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CalendarEvent" ALTER COLUMN "facilityId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RentalBooking" DROP COLUMN "status",
ADD COLUMN     "status" "RentalBookingStatus" NOT NULL DEFAULT 'CONFIRMED';

-- CreateIndex
CREATE INDEX "RentalBooking_status_idx" ON "RentalBooking"("status");
