-- CreateEnum
CREATE TYPE "EnquirySource" AS ENUM ('WALK_IN', 'SELF_GENERATED', 'VIA_TELEPHONIC', 'VIA_WHATSAPP', 'REFERENCE', 'OTHERS');

-- Add new values to InquirySource (keep old values for compatibility)
DO $$
BEGIN
  ALTER TYPE "InquirySource" ADD VALUE IF NOT EXISTS 'WALK_IN';
  ALTER TYPE "InquirySource" ADD VALUE IF NOT EXISTS 'SELF_GENERATED';
  ALTER TYPE "InquirySource" ADD VALUE IF NOT EXISTS 'VIA_TELEPHONIC';
  ALTER TYPE "InquirySource" ADD VALUE IF NOT EXISTS 'VIA_WHATSAPP';
  ALTER TYPE "InquirySource" ADD VALUE IF NOT EXISTS 'REFERENCE';
  ALTER TYPE "InquirySource" ADD VALUE IF NOT EXISTS 'OTHERS';
END $$;

-- AlterTable: Enquiry source type conversion (safe)
ALTER TABLE "Enquiry"
  ALTER COLUMN "source" TYPE "EnquirySource" USING (
    CASE
      WHEN "source" IS NULL THEN NULL
      WHEN UPPER("source") IN (
        'WALK_IN',
        'SELF_GENERATED',
        'VIA_TELEPHONIC',
        'VIA_WHATSAPP',
        'REFERENCE',
        'OTHERS'
      ) THEN UPPER("source")::"EnquirySource"
      ELSE NULL
    END
  );

