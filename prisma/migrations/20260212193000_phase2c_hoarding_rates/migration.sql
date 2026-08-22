-- Phase 2-C: Add standard_rate and minimum_rate for hoarding pricing controls
ALTER TABLE "Hoarding"
ADD COLUMN IF NOT EXISTS "standard_rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "minimum_rate" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Backfill from legacy baseRate where available
UPDATE "Hoarding"
SET
  "standard_rate" = COALESCE("baseRate", "standard_rate", 0),
  "minimum_rate" = COALESCE("minimum_rate", COALESCE("baseRate", "standard_rate", 0));

-- Safety normalization: minimum should not exceed standard by default backfill
UPDATE "Hoarding"
SET "minimum_rate" = "standard_rate"
WHERE "minimum_rate" > "standard_rate";
