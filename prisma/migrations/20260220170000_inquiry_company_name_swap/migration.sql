-- Swap inquiry fields: remove concerned person, add company name

ALTER TABLE "Inquiry"
ADD COLUMN IF NOT EXISTS "companyName" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'Inquiry' AND column_name = 'concernedPersonName'
  ) THEN
    ALTER TABLE "Inquiry" DROP COLUMN "concernedPersonName";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Inquiry_companyName_idx" ON "Inquiry"("companyName");
