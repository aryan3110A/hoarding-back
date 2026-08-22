-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "hoardingCode" TEXT;

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "source" TEXT,
    "preferredArea" TEXT,
    "campaignDates" TEXT,
    "budget" TEXT,
    "hoardingId" TEXT,
    "assignedToId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enquiry_hoardingId_idx" ON "Enquiry"("hoardingId");

-- CreateIndex
CREATE INDEX "Enquiry_assignedToId_idx" ON "Enquiry"("assignedToId");

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
