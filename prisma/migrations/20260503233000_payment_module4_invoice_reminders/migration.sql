ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "reminderAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reminderNote" TEXT,
ADD COLUMN IF NOT EXISTS "lastReminderSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Invoice_reminderAt_idx"
  ON "Invoice"("reminderAt");
