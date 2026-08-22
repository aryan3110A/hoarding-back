import { prisma } from '../src/lib/prisma';

async function seed() {
  const admin = await prisma.user.findFirst();
  if (!admin) {
    console.error('No users found to attribute contract to. Run seeds first.');
    process.exit(1);
  }

  const client = await prisma.client.create({ data: { name: 'Test Client', phone: '0000000000' } });
  const hoarding = await prisma.hoarding.create({
    data: { code: 'HD-TEST-EX', title: 'Test Hoarding', city: 'Test City', status: 'live' },
  });

  const now = new Date();
  const end = new Date();
  end.setDate(now.getDate() + 5); // expires in 5 days

  const c = await prisma.contract.create({
    data: {
      clientId: client.id,
      hoardingId: hoarding.id,
      clientName: client.name,
      hoardingCode: hoarding.code,
      startDate: now,
      endDate: end,
      durationMonths: 1,
      pricePerMonth: 5000,
      totalValue: 5000,
      status: 'ACTIVE',
      createdById: admin.id,
    },
  });

  console.log('Test contract created:', c.id);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
