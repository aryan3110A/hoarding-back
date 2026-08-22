-- Inquiry follow-up tracking enhancements

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'FollowupStatus'
  ) THEN
    CREATE TYPE "FollowupStatus" AS ENUM ('PENDING', 'DONE');
  END IF;
END $$;

ALTER TABLE "Inquiry"
ADD COLUMN IF NOT EXISTS "concernedPersonName" TEXT,
ADD COLUMN IF NOT EXISTS "first_contact_date" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "next_followup_date" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "followup_status" "FollowupStatus" NOT NULL DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS "Inquiry_next_followup_date_idx" ON "Inquiry"("next_followup_date");
