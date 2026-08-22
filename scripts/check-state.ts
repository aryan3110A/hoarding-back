import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const hoarding = await prisma.hoarding.update({
    where: { code: 'SA-95-01' },
    data: { status: 'available' },
  });
  console.log('RESET HOARDING STATUS:', hoarding.status);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
