/*
  Migration notes:
  - The BookingToken table already has rows.
  - We add new columns as NULLable first, backfill them, then enforce NOT NULL.
*/

-- AlterTable (phase 1: add nullable columns)
ALTER TABLE "BookingToken"
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "durationMonths" INTEGER,
  ADD COLUMN "notes" TEXT;

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "companyName" TEXT,
    "createdById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (needed before ON CONFLICT)
CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");

-- Backfill: create a legacy/placeholder client (used only for existing tokens)
INSERT INTO "Client" ("id", "name", "phone", "email", "companyName", "createdById", "isActive", "createdAt", "updatedAt")
VALUES ('legacy-client', 'Legacy Client', '0000000000', NULL, NULL, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("phone") DO NOTHING;

-- Backfill: set durationMonths to a safe default where missing
UPDATE "BookingToken"
SET "durationMonths" = 3
WHERE "durationMonths" IS NULL;

-- Backfill: attach legacy client where missing
UPDATE "BookingToken"
SET "clientId" = (
  SELECT "id" FROM "Client" WHERE "phone" = '0000000000' LIMIT 1
)
WHERE "clientId" IS NULL;

-- AlterTable (phase 2: enforce NOT NULL)
ALTER TABLE "BookingToken"
  ALTER COLUMN "clientId" SET NOT NULL,
  ALTER COLUMN "durationMonths" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");

-- CreateIndex
CREATE INDEX "BookingToken_clientId_idx" ON "BookingToken"("clientId");

-- AddForeignKey
ALTER TABLE "BookingToken" ADD CONSTRAINT "BookingToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
