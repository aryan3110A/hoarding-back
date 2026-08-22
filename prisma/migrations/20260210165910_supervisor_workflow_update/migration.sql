-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "SupervisorChecklist" DROP CONSTRAINT "SupervisorChecklist_hoardingId_fkey";

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PrintingExpense" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SupervisorChecklist" ADD COLUMN     "isSiteImageUploaded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "siteImages" JSONB,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "SupervisorChecklist" ADD CONSTRAINT "SupervisorChecklist_hoardingId_fkey" FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
