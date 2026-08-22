import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

function assertSafeToRun(scriptName: string) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ Refusing to run ${scriptName} in production (NODE_ENV=production).`);
    process.exit(1);
  }

  if (process.env.ALLOW_DESTRUCTIVE_SCRIPTS !== 'true') {
    console.error(
      `❌ ${scriptName} deletes/overwrites data. Set ALLOW_DESTRUCTIVE_SCRIPTS=true to allow this script.`,
    );
    process.exit(1);
  }
}

async function main() {
  assertSafeToRun('seed-rent-demo');
  console.log('Seeding Rent Data for Demo...');

  // 1. Get existing hoardings
  const hoardings = await prisma.hoarding.findMany({
    take: 10,
  });

  if (hoardings.length === 0) {
    console.error('No hoardings found! Please create some hoardings first.');
    return;
  }

  console.log(`Found ${hoardings.length} hoardings. Creating rent records...`);

  // 2. Clear existing rents for these hoardings to avoid unique constraint errors
  const hoardingIds = hoardings.map((h) => h.id);
  await prisma.rent.deleteMany({
    where: {
      hoardingId: {
        in: hoardingIds,
      },
    },
  });

  // 3. Create Rent records with different due dates
  const rents = [
    {
      offsetDays: -2, // Overdue
      partyType: 'Government',
      amount: 1000,
      paymentMode: 'Monthly',
    },
    {
      offsetDays: 0, // Due Today
      partyType: 'Private',
      amount: 1200,
      paymentMode: 'Quarterly',
    },
    {
      offsetDays: 3, // Due in 3 days (Urgent)
      partyType: 'Friend',
      amount: 800,
      paymentMode: 'Yearly',
    },
    {
      offsetDays: 10, // Due in 10 days
      partyType: 'Government',
      amount: 1500,
      paymentMode: 'Monthly',
    },
    {
      offsetDays: 30, // Due in 30 days
      partyType: 'Private',
      amount: 2000,
      paymentMode: 'Half-Yearly',
    },
  ];

  for (let i = 0; i < Math.min(hoardings.length, rents.length); i++) {
    const hoarding = hoardings[i];
    const rentConfig = rents[i];

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + rentConfig.offsetDays);

    await prisma.rent.create({
      data: {
        hoardingId: hoarding.id,
        partyType: rentConfig.partyType,
        rentAmount: rentConfig.amount,
        paymentMode: rentConfig.paymentMode,
        nextDueDate: dueDate,
        incrementYear: 1,
      },
    });

    // Update hoarding status to 'on_rent'
    await prisma.hoarding.update({
      where: { id: hoarding.id },
      data: { status: 'on_rent' },
    });

    console.log(
      `Created Rent for ${hoarding.code}: Due in ${rentConfig.offsetDays} days (${dueDate.toLocaleDateString()})`,
    );
  }

  console.log('Rent seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
