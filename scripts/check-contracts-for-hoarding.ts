import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log('Usage: npx ts-node scripts/check-contracts-for-hoarding.ts <hoardingId|recent>');
    console.log('  <hoardingId>  - show contracts and tokens for that hoarding');
    console.log('  recent         - list recent fitted hoardings missing contracts');
    process.exit(1);
  }

  if (arg === 'recent') {
    // find recent booking tokens marked fitterCompleted in last 7 days
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const tokens = await prisma.bookingToken.findMany({
      where: {
        fitterCompletedAt: { gte: since },
      },
      orderBy: { fitterCompletedAt: 'desc' },
      take: 50,
    });

    console.log(`Found ${tokens.length} recent fitted booking tokens (last 7 days)`);
    for (const t of tokens) {
      const contracts = await prisma.contract.findMany({ where: { hoardingId: t.hoardingId } });
      const hasPending = contracts.some((c) => c.status === 'PENDING_ACTIVATION');
      const hasActive = contracts.some((c) => c.status === 'ACTIVE');
      console.log(`- Hoarding ${t.hoardingId} token ${t.id} fitted at ${t.fitterCompletedAt}`);
      console.log(`  Contracts: ${contracts.length} (pending:${hasPending} active:${hasActive})`);
    }
    await prisma.$disconnect();
    return;
  }

  const hoardingId = arg;
  const contracts = await prisma.contract.findMany({ where: { hoardingId } });
  console.log(`Contracts for hoarding ${hoardingId}: ${contracts.length}`);
  contracts.forEach((c) => {
    console.log(
      `- id:${c.id} number:${(c as any).contractNumber} status:${c.status} start:${c.startDate} end:${c.endDate} createdBy:${(c as any).createdById}`,
    );
  });

  const tokens = await prisma.bookingToken.findMany({ where: { hoardingId } });
  console.log(`Booking tokens for hoarding ${hoardingId}: ${tokens.length}`);
  tokens.forEach((t) => {
    console.log(
      `- id:${t.id} status:${(t as any).status} fitterStatus:${(t as any).fitterStatus} fitterCompletedAt:${(t as any).fitterCompletedAt}`,
    );
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
