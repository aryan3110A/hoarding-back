-- Blocking & queue integrity + task attachments
--
-- Business rule: ONE hoarding = MAXIMUM ONE active block. Everyone else waits in a FIFO queue.
--   BLOCKED / EXTENSION_REQUESTED  -> the single active block
--   PENDING                        -> waiting in queue
--   EXPIRED / RELEASED / APPROVED  -> history (expired, closed/cancelled, booked)

-- 1) Proposal reference on tokens (was only a [[PROPOSAL_ID:..]] marker inside notes)
ALTER TABLE "BookingToken" ADD COLUMN IF NOT EXISTS "proposalId" TEXT;
CREATE INDEX IF NOT EXISTS "BookingToken_proposalId_idx" ON "BookingToken" ("proposalId");

UPDATE "BookingToken"
SET "proposalId" = substring("notes" from '\[\[PROPOSAL_ID:([^\]]+)\]\]')
WHERE "proposalId" IS NULL
  AND "notes" LIKE '%[[PROPOSAL_ID:%';

-- 2) Clean existing data so the unique rule can be enforced.
--    a) legacy ACTIVE tokens whose block window is over are expired
UPDATE "BookingToken"
SET "status" = 'EXPIRED'
WHERE "status" IN ('ACTIVE', 'BLOCKED', 'EXTENSION_REQUESTED')
  AND "expiresAt" < NOW();

--    b) legacy ACTIVE tokens still inside their window become real blocks
UPDATE "BookingToken"
SET "status" = 'BLOCKED',
    "blockedAt" = COALESCE("blockedAt", "createdAt")
WHERE "status" = 'ACTIVE';

--    c) if a hoarding somehow has several active blocks, the oldest keeps it and the rest queue up
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "hoardingId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "BookingToken"
  WHERE "status" IN ('BLOCKED', 'EXTENSION_REQUESTED')
)
UPDATE "BookingToken" t
SET "status" = 'PENDING',
    "blockedAt" = NULL,
    "extensionRequestedAt" = NULL,
    "extensionRequestedUntil" = NULL
FROM ranked r
WHERE t."id" = r."id" AND r.rn > 1;

--    d) renumber queue positions (active block = 1, waiting entries = 2, 3, ... in FIFO order)
WITH q AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "hoardingId"
           ORDER BY CASE WHEN "status" IN ('BLOCKED', 'EXTENSION_REQUESTED') THEN 0 ELSE 1 END,
                    "createdAt" ASC, "id" ASC
         ) AS pos
  FROM "BookingToken"
  WHERE "status" IN ('PENDING', 'BLOCKED', 'EXTENSION_REQUESTED')
)
UPDATE "BookingToken" t
SET "queuePosition" = q.pos
FROM q
WHERE t."id" = q."id";

-- 3) Database-level guarantee: a hoarding can never have two active blocks at once.
CREATE UNIQUE INDEX IF NOT EXISTS "BookingToken_one_active_block_per_hoarding"
  ON "BookingToken" ("hoardingId")
  WHERE "status" IN ('BLOCKED', 'EXTENSION_REQUESTED');

-- 4) Task module: location link + photo attachments.
--    TodoItem was historically created outside the migration history (db push), so create it
--    if it is missing and add the new columns if it already exists.
CREATE TABLE IF NOT EXISTS "TodoItem" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "dueDate"      TIMESTAMP(3),
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "createdById"  TEXT NOT NULL,
  "visibility"   TEXT NOT NULL DEFAULT 'private',
  "roleName"     TEXT,
  "tags"         TEXT,
  "locationLink" TEXT,
  "attachments"  JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TodoItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TodoItem"
  ADD COLUMN IF NOT EXISTS "locationLink" TEXT,
  ADD COLUMN IF NOT EXISTS "attachments" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TodoItem_createdById_fkey') THEN
    ALTER TABLE "TodoItem"
      ADD CONSTRAINT "TodoItem_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
