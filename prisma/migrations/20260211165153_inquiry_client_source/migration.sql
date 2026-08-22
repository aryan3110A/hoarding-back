-- CreateEnum
CREATE TYPE "InquirySource" AS ENUM ('PHONE', 'EMAIL', 'MESSAGE', 'WHATSAPP', 'OTHER');

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "source" "InquirySource" NOT NULL DEFAULT 'PHONE';

-- CreateIndex
CREATE INDEX "Inquiry_clientId_idx" ON "Inquiry"("clientId");

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
