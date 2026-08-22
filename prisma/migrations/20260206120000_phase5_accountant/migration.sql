-- Phase 5: Accountant (Invoices, Payments, Printing Expenses)

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "invoiceNumber" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "contractId" TEXT,
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "subtotal" DECIMAL(14, 2) NOT NULL,
  "taxAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14, 2) NOT NULL,
  "paidAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX IF NOT EXISTS "Invoice_clientId_idx" ON "Invoice"("clientId");
CREATE INDEX IF NOT EXISTS "Invoice_contractId_idx" ON "Invoice"("contractId");
CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX IF NOT EXISTS "Invoice_createdById_idx" ON "Invoice"("createdById");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Payment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(14, 2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
  "reference" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX IF NOT EXISTS "Payment_createdById_idx" ON "Payment"("createdById");
CREATE INDEX IF NOT EXISTS "Payment_paidAt_idx" ON "Payment"("paidAt");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "PrintingExpense" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "contractId" TEXT,
  "clientId" TEXT,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(14, 2) NOT NULL,
  "incurredOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vendor" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrintingExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PrintingExpense_contractId_idx" ON "PrintingExpense"("contractId");
CREATE INDEX IF NOT EXISTS "PrintingExpense_clientId_idx" ON "PrintingExpense"("clientId");
CREATE INDEX IF NOT EXISTS "PrintingExpense_createdById_idx" ON "PrintingExpense"("createdById");
CREATE INDEX IF NOT EXISTS "PrintingExpense_incurredOn_idx" ON "PrintingExpense"("incurredOn");

ALTER TABLE "PrintingExpense" ADD CONSTRAINT "PrintingExpense_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintingExpense" ADD CONSTRAINT "PrintingExpense_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintingExpense" ADD CONSTRAINT "PrintingExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
