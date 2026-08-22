-- CreateEnum
CREATE TYPE "FitterStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "BookingToken" ADD COLUMN     "fitterAssignedAt" TIMESTAMP(3),
ADD COLUMN     "fitterCompletedAt" TIMESTAMP(3),
ADD COLUMN     "fitterId" TEXT,
ADD COLUMN     "fitterNotes" TEXT,
ADD COLUMN     "fitterStartedAt" TIMESTAMP(3),
ADD COLUMN     "fitterStatus" "FitterStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "BookingToken_fitterId_idx" ON "BookingToken"("fitterId");

-- AddForeignKey
ALTER TABLE "BookingToken" ADD CONSTRAINT "BookingToken_fitterId_fkey" FOREIGN KEY ("fitterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
