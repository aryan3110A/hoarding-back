import { prisma } from '../src/lib/prisma';

async function seedHoardings() {
  console.log('Seeding hoardings...');

  for (let i = 1; i <= 1000; i++) {
    await prisma.hoarding.create({
      data: {
        code: `TEST-H-${i}`,
        city: 'Mehsana',
        area: 'Test Area',
        status: 'AVAILABLE',
      },
    });
  }

  console.log('Hoardings created');
}

seedHoardings()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
