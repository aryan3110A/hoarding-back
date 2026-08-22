-- Proposal Builder Phase 2 enhancement

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProposalDiscountType'
  ) THEN
    CREATE TYPE "ProposalDiscountType" AS ENUM ('FLAT', 'PERCENT');
  END IF;
END $$;

ALTER TABLE "Proposal"
ADD COLUMN IF NOT EXISTS "proposalDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "discountType" "ProposalDiscountType" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN IF NOT EXISTS "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "printingCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "mountingCharges" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Proposal"
SET "proposalDate" = COALESCE("proposalDate", "createdAt")
WHERE "proposalDate" IS NULL;

ALTER TABLE "Proposal"
ALTER COLUMN "proposalDate" SET NOT NULL;
