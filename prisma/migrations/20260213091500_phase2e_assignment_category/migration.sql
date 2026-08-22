-- Phase 2-E3/E4: Inquiry assignment + categories

CREATE TABLE IF NOT EXISTS "Category" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");

ALTER TABLE "Hoarding"
ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

ALTER TABLE "Inquiry"
ADD COLUMN IF NOT EXISTS "assignedSalesId" TEXT,
ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

CREATE INDEX IF NOT EXISTS "Hoarding_categoryId_idx" ON "Hoarding"("categoryId");
CREATE INDEX IF NOT EXISTS "Inquiry_assignedSalesId_idx" ON "Inquiry"("assignedSalesId");
CREATE INDEX IF NOT EXISTS "Inquiry_categoryId_idx" ON "Inquiry"("categoryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Hoarding_categoryId_fkey'
  ) THEN
    ALTER TABLE "Hoarding"
      ADD CONSTRAINT "Hoarding_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Inquiry_assignedSalesId_fkey'
  ) THEN
    ALTER TABLE "Inquiry"
      ADD CONSTRAINT "Inquiry_assignedSalesId_fkey"
      FOREIGN KEY ("assignedSalesId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Inquiry_categoryId_fkey'
  ) THEN
    ALTER TABLE "Inquiry"
      ADD CONSTRAINT "Inquiry_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
