-- Contract renewal reminder tracking fields

ALTER TABLE "Contract"
ADD COLUMN IF NOT EXISTS "renewalMessageSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "renewalMessageSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "renewalMessageSentById" TEXT;

CREATE INDEX IF NOT EXISTS "Contract_renewalMessageSent_idx" ON "Contract"("renewalMessageSent");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Contract_renewalMessageSentById_fkey'
  ) THEN
    ALTER TABLE "Contract"
      ADD CONSTRAINT "Contract_renewalMessageSentById_fkey"
      FOREIGN KEY ("renewalMessageSentById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
