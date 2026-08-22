/*
  Warnings:

  - You are about to drop the column `status` on the `ProposalHoarding` table. All the data in the column will be lost.
  - Added the required column `hoardingCode` to the `ProposalHoarding` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProposalMode" AS ENUM ('WITH_RATE', 'WITHOUT_RATE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'FINALIZED');

-- DropForeignKey
ALTER TABLE "ProposalHoarding" DROP CONSTRAINT "ProposalHoarding_hoardingId_fkey";

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "globalDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gstRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
ADD COLUMN     "includeGst" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode" "ProposalMode" NOT NULL DEFAULT 'WITH_RATE',
ADD COLUMN     "pdfGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "pdfPath" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ProposalHoarding" DROP COLUMN "status",
ADD COLUMN     "area" TEXT,
ADD COLUMN     "baseRate" DECIMAL(14,2),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "finalRate" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hoardingCode" TEXT,
ADD COLUMN     "illumination" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "illuminationCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "orderIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sizeLabel" TEXT,
ADD COLUMN     "type" TEXT,
ALTER COLUMN "hoardingId" DROP NOT NULL;

-- Backfill snapshot fields for existing rows (if any)
UPDATE "ProposalHoarding" ph
SET
  "hoardingCode" = COALESCE(h."code", ''),
  "city" = h."city",
  "area" = h."area",
  "location" = COALESCE(h."landmark", h."roadName"),
  "type" = h."type",
  "baseRate" = h."baseRate"
FROM "Hoarding" h
WHERE ph."hoardingId" = h."id";

UPDATE "ProposalHoarding"
SET "hoardingCode" = ''
WHERE "hoardingCode" IS NULL;

ALTER TABLE "ProposalHoarding"
ALTER COLUMN "hoardingCode" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- AddForeignKey
ALTER TABLE "ProposalHoarding" ADD CONSTRAINT "ProposalHoarding_hoardingId_fkey" FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
