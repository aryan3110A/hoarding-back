import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Updating the status column to "available" for all hoardings...');

  const result = await prisma.hoarding.updateMany({
    data: {
      status: 'available',
      actualLiveDate: null,
      expiryDate: null,
      billingStartDate: null,
      billingStartOverrideDate: null,
      lastRenewedAt: null,
      finalRate: null,
      bookedAt: null,
      bookedById: null,
      workflowState: null,
    },
  });

  console.log(`✅ Successfully updated status to "available" for all ${result.count} hoardings!`);
}

main()
  .catch((e) => {
    console.error('❌ Error updating hoarding statuses:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
