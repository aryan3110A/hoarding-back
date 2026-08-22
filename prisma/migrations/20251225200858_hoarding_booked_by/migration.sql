-- AlterTable
ALTER TABLE "Hoarding" ADD COLUMN     "bookedAt" TIMESTAMP(3),
ADD COLUMN     "bookedById" TEXT;

-- AddForeignKey
ALTER TABLE "Hoarding" ADD CONSTRAINT "Hoarding_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
