-- CreateEnum
CREATE TYPE "RemountStatus" AS ENUM ('PENDING', 'COMPLETED');

-- AlterTable
ALTER TABLE "Hoarding"
ADD COLUMN "final_rate" DECIMAL(14,2),
ADD COLUMN "expiry_date" TIMESTAMP(3),
ADD COLUMN "last_renewed_at" TIMESTAMP(3),
ADD COLUMN "remountStatus" "RemountStatus",
ADD COLUMN "remount_requested_by" TEXT,
ADD COLUMN "remount_requested_at" TIMESTAMP(3),
ADD COLUMN "remount_completed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HoardingRenewal" (
    "id" TEXT NOT NULL,
    "hoardingId" TEXT NOT NULL,
    "previous_expiry_date" TIMESTAMP(3),
    "new_expiry_date" TIMESTAMP(3) NOT NULL,
    "renewed_by" TEXT NOT NULL,
    "renewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "new_amount" DECIMAL(14,2) NOT NULL,
    "tenure" INTEGER NOT NULL,
    "remount_required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoardingRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HoardingRenewal_hoardingId_idx" ON "HoardingRenewal"("hoardingId");

-- CreateIndex
CREATE INDEX "HoardingRenewal_renewed_by_idx" ON "HoardingRenewal"("renewed_by");

-- CreateIndex
CREATE INDEX "HoardingRenewal_renewed_at_idx" ON "HoardingRenewal"("renewed_at" DESC);

-- AddForeignKey
ALTER TABLE "HoardingRenewal" ADD CONSTRAINT "HoardingRenewal_hoardingId_fkey" FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoardingRenewal" ADD CONSTRAINT "HoardingRenewal_renewed_by_fkey" FOREIGN KEY ("renewed_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
