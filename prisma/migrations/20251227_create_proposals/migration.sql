-- Migration: Create Proposal and ProposalHoarding tables (align with existing naming)

-- Create Proposal table with UUID id to match existing conventions
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Proposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Proposal_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create ProposalHoarding linking table
CREATE TABLE "ProposalHoarding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "hoardingId" TEXT NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending',
    CONSTRAINT "ProposalHoarding_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalHoarding_hoardingId_fkey" FOREIGN KEY ("hoardingId") REFERENCES "Hoarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indexes
CREATE INDEX "Proposal_clientId_idx" ON "Proposal"("clientId");
CREATE INDEX "Proposal_salesUserId_idx" ON "Proposal"("salesUserId");
CREATE INDEX "ProposalHoarding_proposalId_idx" ON "ProposalHoarding"("proposalId");
CREATE INDEX "ProposalHoarding_hoardingId_idx" ON "ProposalHoarding"("hoardingId");
