import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('⚠️ WARNING: This will delete all client records and all referencing records (BookingTokens, Invoices, Proposals, Inquiries, etc.) to satisfy database foreign key constraints.');
  console.log('Clearing Client table records (cascading)...');

  // Truncate table with cascade
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Client" CASCADE;');

  console.log('✅ Client table and all dependent records have been cleared successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error clearing client data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
