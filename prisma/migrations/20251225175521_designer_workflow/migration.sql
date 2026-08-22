-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "BookingToken" ADD COLUMN     "designNotes" TEXT,
ADD COLUMN     "designStatus" "DesignStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "designerId" TEXT;

-- CreateIndex
CREATE INDEX "BookingToken_designerId_idx" ON "BookingToken"("designerId");

-- AddForeignKey
ALTER TABLE "BookingToken" ADD CONSTRAINT "BookingToken_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
