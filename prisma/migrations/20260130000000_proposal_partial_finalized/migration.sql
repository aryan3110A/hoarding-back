-- Add PARTIAL_FINALIZED to ProposalStatus enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProposalStatus'
      AND e.enumlabel = 'PARTIAL_FINALIZED'
  ) THEN
    ALTER TYPE "ProposalStatus" ADD VALUE 'PARTIAL_FINALIZED';
  END IF;
END $$;
