-- CreateEnum
CREATE TYPE "IncrementType" AS ENUM ('PERCENTAGE', 'AMOUNT');

-- AlterTable
ALTER TABLE "PropertyRent" ADD COLUMN     "baseRent" DECIMAL(14,2),
ADD COLUMN     "incrementType" "IncrementType" DEFAULT 'PERCENTAGE',
ADD COLUMN     "incrementValue" DECIMAL(14,2),
ADD COLUMN     "lastIncrementDate" TIMESTAMP(3),
ADD COLUMN     "nextIncrementDate" TIMESTAMP(3),
ADD COLUMN     "rentStartDate" TIMESTAMP(3);
