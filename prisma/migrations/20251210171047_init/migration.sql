-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BookingToken" (
    "id" TEXT NOT NULL,
    "hoardingId" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "queuePosition" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingToken_hoardingId_dateFrom_dateTo_idx" ON "BookingToken"("hoardingId", "dateFrom", "dateTo");

-- AddForeignKey
ALTER TABLE "BookingToken" ADD CONSTRAINT "BookingToken_hoardingId_fkey" FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingToken" ADD CONSTRAINT "BookingToken_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
