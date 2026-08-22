-- Phase 3: Blocking logic (Token & Time Management)

-- Extend TokenStatus enum (backward compatible)
ALTER TYPE "TokenStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "TokenStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE "TokenStatus" ADD VALUE IF NOT EXISTS 'EXTENSION_REQUESTED';
ALTER TYPE "TokenStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "TokenStatus" ADD VALUE IF NOT EXISTS 'RELEASED';

-- Add blocking/extension/release audit fields
ALTER TABLE "BookingToken"
  ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "blockDurationHours" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS "extensionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "extensionRequestedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "extensionApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "extensionApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "releasedById" TEXT,
  ADD COLUMN IF NOT EXISTS "releaseReason" TEXT;

-- Helpful index for expiry scans
CREATE INDEX IF NOT EXISTS "BookingToken_status_expiresAt_idx" ON "BookingToken" ("status", "expiresAt");

-- Foreign keys (audit)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingToken_extensionApprovedById_fkey'
  ) THEN
    ALTER TABLE "BookingToken"
      ADD CONSTRAINT "BookingToken_extensionApprovedById_fkey"
      FOREIGN KEY ("extensionApprovedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingToken_releasedById_fkey'
  ) THEN
    ALTER TABLE "BookingToken"
      ADD CONSTRAINT "BookingToken_releasedById_fkey"
      FOREIGN KEY ("releasedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
