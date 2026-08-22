-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('Monthly', 'Quarterly', 'HalfYearly', 'Yearly');

-- AlterTable
ALTER TABLE "Hoarding" ADD COLUMN     "propertyGroupId" VARCHAR(100);

-- CreateTable
CREATE TABLE "PropertyRent" (
    "id" TEXT NOT NULL,
    "propertyGroupId" TEXT NOT NULL,
    "location" TEXT,
    "rentAmount" DECIMAL(14,2) NOT NULL,
    "incrementCycleYears" INTEGER NOT NULL DEFAULT 1,
    "incrementRate" DECIMAL(5,2) NOT NULL DEFAULT 0.10,
    "paymentFrequency" "PaymentFrequency" NOT NULL,
    "lastPaymentDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "reminderDays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyRent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyRent_propertyGroupId_key" ON "PropertyRent"("propertyGroupId");

-- CreateIndex
CREATE INDEX "Hoarding_propertyGroupId_idx" ON "Hoarding"("propertyGroupId");

-- AddForeignKey
ALTER TABLE "Hoarding" ADD CONSTRAINT "Hoarding_propertyGroupId_fkey" FOREIGN KEY ("propertyGroupId") REFERENCES "PropertyRent"("propertyGroupId") ON DELETE SET NULL ON UPDATE CASCADE;
