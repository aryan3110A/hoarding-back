DO $$ BEGIN
  CREATE TYPE "PaymentPlanType" AS ENUM (
    'ADVANCE_MONTHLY',
    'ADVANCE_FULL_CAMPAIGN',
    'ON_SPOT_LIVE',
    'POST_MONTHLY',
    'END_OF_CAMPAIGN',
    'MONTHLY_IN_HAND'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingEventStatus" AS ENUM (
    'UPCOMING_SCHEDULED',
    'TO_BE_GENERATED',
    'PO_PENDING',
    'OVERDUE',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Hoarding"
  ADD COLUMN IF NOT EXISTS "actual_live_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billing_start_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billing_start_override_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billing_period_override_note" TEXT;

ALTER TABLE "BookingToken"
  ADD COLUMN IF NOT EXISTS "paymentPlanType" "PaymentPlanType",
  ADD COLUMN IF NOT EXISTS "billingFrequency" "BillingFrequency",
  ADD COLUMN IF NOT EXISTS "gstApplicable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "finalAgreedBasePrice" DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS "modeOfPayment" TEXT,
  ADD COLUMN IF NOT EXISTS "printingChargesBase" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mountingChargesBase" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "poRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "poNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "expectedPoDate" TIMESTAMP(3);

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "billingCompanyName" TEXT,
  ADD COLUMN IF NOT EXISTS "billingPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "billingEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "gstin" TEXT,
  ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "billingFirm" TEXT,
  ADD COLUMN IF NOT EXISTS "billPdfPath" TEXT;

CREATE TABLE IF NOT EXISTS "BillingEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "hoardingId" TEXT NOT NULL,
  "bookingTokenId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "cycleNumber" INTEGER NOT NULL,
  "status" "BillingEventStatus" NOT NULL DEFAULT 'UPCOMING_SCHEDULED',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "billingAnchorDate" TIMESTAMP(3) NOT NULL,
  "liveEligibleAt" TIMESTAMP(3),
  "notificationSentAt" TIMESTAMP(3),
  "poPendingAt" TIMESTAMP(3),
  "overdueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "baseAmount" DECIMAL(14, 2) NOT NULL,
  "gstApplicable" BOOLEAN NOT NULL DEFAULT false,
  "gstRatePct" DECIMAL(5, 2) NOT NULL DEFAULT 18,
  "gstAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14, 2) NOT NULL,
  "printingBase" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "printingGst" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "printingTotal" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "mountingBase" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "mountingGst" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "mountingTotal" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "paymentPlanType" "PaymentPlanType" NOT NULL,
  "billingFrequency" "BillingFrequency" NOT NULL,
  "modeOfPayment" TEXT,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_bookingTokenId_cycleNumber_key"
  ON "BillingEvent"("bookingTokenId", "cycleNumber");
CREATE INDEX IF NOT EXISTS "BillingEvent_clientId_status_idx"
  ON "BillingEvent"("clientId", "status");
CREATE INDEX IF NOT EXISTS "BillingEvent_hoardingId_idx"
  ON "BillingEvent"("hoardingId");
CREATE INDEX IF NOT EXISTS "BillingEvent_status_dueAt_idx"
  ON "BillingEvent"("status", "dueAt");
CREATE INDEX IF NOT EXISTS "BillingEvent_bookingTokenId_idx"
  ON "BillingEvent"("bookingTokenId");
CREATE INDEX IF NOT EXISTS "BillingEvent_invoiceId_idx"
  ON "BillingEvent"("invoiceId");

DO $$ BEGIN
  ALTER TABLE "BillingEvent"
    ADD CONSTRAINT "BillingEvent_hoardingId_fkey"
    FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "BillingEvent"
    ADD CONSTRAINT "BillingEvent_bookingTokenId_fkey"
    FOREIGN KEY ("bookingTokenId") REFERENCES "BookingToken"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "BillingEvent"
    ADD CONSTRAINT "BillingEvent_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "BillingEvent"
    ADD CONSTRAINT "BillingEvent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
