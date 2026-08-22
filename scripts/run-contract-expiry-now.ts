// Run this script with ts-node when needed, for example:
// npx ts-node scripts/run-contract-expiry-now.ts
import { runContractExpiryJob } from '../src/jobs/contractExpiry.job';
import { prisma } from '../src/lib/prisma';

(async () => {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('Running contract expiry job now...');
    await runContractExpiryJob();
    console.log('Contract expiry job finished.');
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Contract expiry job error:', err);
    try {
      await prisma.$disconnect();
    } catch (_) {}
    process.exit(1);
  }
})();
