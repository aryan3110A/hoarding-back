DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'InquiryPerformanceStage'
  ) THEN
    CREATE TYPE "InquiryPerformanceStage" AS ENUM (
      'IN_PROCESS',
      'WON',
      'FOLLOW_UP_LATER',
      'DEAD',
      'NOT_INTERESTED'
    );
  END IF;
END $$;

ALTER TABLE "Inquiry"
ADD COLUMN IF NOT EXISTS "performanceStage" "InquiryPerformanceStage" NOT NULL DEFAULT 'IN_PROCESS';

CREATE TABLE IF NOT EXISTS "SalesMarketVisit" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "visitDate" TIMESTAMP(3) NOT NULL,
  "visitedMarket" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesMarketVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalesMarketVisit_userId_visitDate_key"
  ON "SalesMarketVisit"("userId", "visitDate");
CREATE INDEX IF NOT EXISTS "SalesMarketVisit_visitDate_idx"
  ON "SalesMarketVisit"("visitDate");
CREATE INDEX IF NOT EXISTS "SalesMarketVisit_userId_idx"
  ON "SalesMarketVisit"("userId");

DO $$ BEGIN
  ALTER TABLE "SalesMarketVisit"
    ADD CONSTRAINT "SalesMarketVisit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;