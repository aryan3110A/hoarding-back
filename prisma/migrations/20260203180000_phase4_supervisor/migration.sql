-- Phase 4: Supervisor workflow, execution type, checklist

DO $$ BEGIN
  CREATE TYPE "ExecutionType" AS ENUM ('CLIENT_CDR', 'IN_HOUSE_DESIGN', 'CLIENT_DIRECT_FLEX');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "HoardingCondition" AS ENUM ('GOOD', 'DAMAGED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Hoarding"
  ADD COLUMN IF NOT EXISTS "executionType" "ExecutionType",
  ADD COLUMN IF NOT EXISTS "condition" "HoardingCondition";

CREATE TABLE IF NOT EXISTS "SupervisorChecklist" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "hoardingId" TEXT NOT NULL,
  "isCorrectSize" BOOLEAN NOT NULL DEFAULT false,
  "isGoodCondition" BOOLEAN NOT NULL DEFAULT false,
  "isFlexReceived" BOOLEAN NOT NULL DEFAULT false,
  "isReadyForInstall" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupervisorChecklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupervisorChecklist_hoardingId_key" ON "SupervisorChecklist"("hoardingId");
CREATE INDEX IF NOT EXISTS "SupervisorChecklist_updatedById_idx" ON "SupervisorChecklist"("updatedById");

ALTER TABLE "SupervisorChecklist" ADD CONSTRAINT "SupervisorChecklist_hoardingId_fkey" FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupervisorChecklist" ADD CONSTRAINT "SupervisorChecklist_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rename existing FITTER role to SUPERVISOR if present
UPDATE "Role" SET "name" = 'supervisor' WHERE LOWER("name") = 'fitter';

-- Ensure supervisor role exists
INSERT INTO "Role" ("name")
SELECT 'supervisor'
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE LOWER("name") = 'supervisor');

-- Backfill checklist rows for existing booked/under_process/live hoardings
WITH any_user AS (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1
)
INSERT INTO "SupervisorChecklist" ("hoardingId", "updatedById")
SELECT h."id", any_user."id"
FROM "Hoarding" h, any_user
WHERE h."status" IN ('booked', 'under_process', 'live')
  AND NOT EXISTS (
    SELECT 1 FROM "SupervisorChecklist" sc WHERE sc."hoardingId" = h."id"
  );
