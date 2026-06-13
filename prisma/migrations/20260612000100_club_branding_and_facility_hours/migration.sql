-- Phase 16 Step 2 (D3/D4): club branding fields + facility hours/description.

-- Club branding
ALTER TABLE "Club" ADD COLUMN "tagline" VARCHAR(200);
ALTER TABLE "Club" ADD COLUMN "description" TEXT;
ALTER TABLE "Club" ADD COLUMN "websiteUrl" VARCHAR(500);
ALTER TABLE "Club" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "Club" ADD COLUMN "logoImageId" TEXT;
ALTER TABLE "Club" ADD COLUMN "heroImageId" TEXT;
ALTER TABLE "Club" ADD CONSTRAINT "Club_logoImageId_fkey" FOREIGN KEY ("logoImageId") REFERENCES "ContentImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Club" ADD CONSTRAINT "Club_heroImageId_fkey" FOREIGN KEY ("heroImageId") REFERENCES "ContentImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Facility hours + blurb + hero
ALTER TABLE "ClubFacility" ADD COLUMN "operatingHours" JSONB;
ALTER TABLE "ClubFacility" ADD COLUMN "description" TEXT;
ALTER TABLE "ClubFacility" ADD COLUMN "heroImageId" TEXT;
ALTER TABLE "ClubFacility" ADD CONSTRAINT "ClubFacility_heroImageId_fkey" FOREIGN KEY ("heroImageId") REFERENCES "ContentImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
