/*
  Warnings:

  - Made the column `status` on table `ProposalHoarding` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'EXPIRING_SOON', 'COMPLETED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "ProposalHoarding" DROP CONSTRAINT "ProposalHoarding_proposalId_fkey";

-- AlterTable
ALTER TABLE "ProposalHoarding" ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hoardingId" TEXT NOT NULL,
    "bookingId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "durationMonths" INTEGER NOT NULL,
    "basePrice" DECIMAL(14,2) NOT NULL,
    "totalValue" DECIMAL(14,2) NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "renewedFromId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "Contract_hoardingId_idx" ON "Contract"("hoardingId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- AddForeignKey
ALTER TABLE "ProposalHoarding" ADD CONSTRAINT "ProposalHoarding_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
