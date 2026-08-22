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
      `❌ ${scriptName} deletes data. Set ALLOW_DESTRUCTIVE_SCRIPTS=true to allow this script.`,
    );
    process.exit(1);
  }
}

async function removeDemoHoardings() {
  assertSafeToRun('remove-demo-hoardings');
  console.log('Removing demo hoardings (H001-H008)...');

  const demoCodes = ['H001', 'H002', 'H003', 'H004', 'H005', 'H006', 'H007', 'H008'];

  try {
    // First, find all demo hoardings
    const demoHoardings = await prisma.hoarding.findMany({
      where: {
        code: {
          in: demoCodes,
        },
      },
    });

    console.log(`Found ${demoHoardings.length} demo hoardings to delete`);

    if (demoHoardings.length === 0) {
      console.log('No demo hoardings found. Nothing to delete.');
      return;
    }

    const hoardingIds = demoHoardings.map((h) => h.id);

    // Delete associated rent records first (foreign key constraint)
    const deletedRents = await prisma.rent.deleteMany({
      where: {
        hoardingId: {
          in: hoardingIds,
        },
      },
    });
    console.log(`Deleted ${deletedRents.count} rent records`);

    // Delete associated bookings if any
    const deletedBookings = await prisma.booking.deleteMany({
      where: {
        hoardingId: {
          in: hoardingIds,
        },
      },
    });
    console.log(`Deleted ${deletedBookings.count} booking records`);

    // Delete the hoardings
    const deletedHoardings = await prisma.hoarding.deleteMany({
      where: {
        code: {
          in: demoCodes,
        },
      },
    });

    console.log(`✅ Deleted ${deletedHoardings.count} demo hoardings`);

    // Count remaining hoardings
    const remainingCount = await prisma.hoarding.count();
    console.log(`📊 Total hoardings remaining in database: ${remainingCount}`);
  } catch (error) {
    console.error('Error removing demo hoardings:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

removeDemoHoardings().catch((e) => {
  console.error(e);
  process.exit(1);
});
