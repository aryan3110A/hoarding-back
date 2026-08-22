import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

const CONFIRM_TOKEN = 'DELETE_DATA_ONLY';
const EXCLUDED_MODELS = ['Hoarding', 'Role', 'User'] as const;

type CleanupStep = {
  label: string;
  run: (db: PrismaClient | Prisma.TransactionClient) => Promise<Prisma.BatchPayload>;
  countsAsDelete?: boolean;
};

function getConfirmArgValue(): string | null {
  const confirmArg = process.argv.find((arg) => arg.startsWith('--confirm='));
  if (!confirmArg) return null;
  const [, value] = confirmArg.split('=');
  return value ?? null;
}

function assertSafeToRun(): void {
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();

  if (nodeEnv === 'production') {
    console.warn(
      '⚠️  NODE_ENV is production. Continuing because explicit confirmation is required.',
    );
  }

  const confirmValue = getConfirmArgValue();
  if (confirmValue !== CONFIRM_TOKEN) {
    console.log('⚠️  This script deletes ONLY row data (never tables/schema).');
    console.log(`⚠️  Excluded models: ${EXCLUDED_MODELS.join(', ')}`);
    console.log('');
    console.log('Run with confirmation token:');
    console.log(`npx ts-node scripts/purge-data-except-core.ts --confirm=${CONFIRM_TOKEN}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertSafeToRun();

  console.log('ℹ️  Running cleanup in sequential mode (no single long transaction).');

  const steps: CleanupStep[] = [
    {
      label: 'Reset hoarding status/state and detach category/landlord/propertyRent',
      countsAsDelete: false,
      run: (tx) =>
        tx.hoarding.updateMany({
          data: {
            status: 'available',
            workflowState: null,
            bookedById: null,
            bookedAt: null,
            expiryDate: null,
            remountStatus: null,
            remountRequestedBy: null,
            remountRequestedAt: null,
            remountCompletedAt: null,
            categoryId: null,
            landlordId: null,
            propertyGroupId: null,
          },
        }),
    },
    { label: 'Payment', run: (tx) => tx.payment.deleteMany() },
    { label: 'PrintingExpense', run: (tx) => tx.printingExpense.deleteMany() },
    { label: 'Invoice', run: (tx) => tx.invoice.deleteMany() },
    { label: 'Contract', run: (tx) => tx.contract.deleteMany() },
    { label: 'ProposalHoarding', run: (tx) => tx.proposalHoarding.deleteMany() },
    { label: 'Proposal', run: (tx) => tx.proposal.deleteMany() },
    { label: 'BookingToken', run: (tx) => tx.bookingToken.deleteMany() },
    { label: 'Booking', run: (tx) => tx.booking.deleteMany() },
    { label: 'SupervisorChecklist', run: (tx) => tx.supervisorChecklist.deleteMany() },
    { label: 'HoardingRenewal', run: (tx) => tx.hoardingRenewal.deleteMany() },
    { label: 'Inquiry', run: (tx) => tx.inquiry.deleteMany() },
    { label: 'Enquiry', run: (tx) => tx.enquiry.deleteMany() },
    { label: 'Rent', run: (tx) => tx.rent.deleteMany() },
    { label: 'Notification', run: (tx) => tx.notification.deleteMany() },
    { label: 'LocationLog', run: (tx) => tx.locationLog.deleteMany() },
    { label: 'RefreshSession', run: (tx) => tx.refreshSession.deleteMany() },
    { label: 'UserDevice', run: (tx) => tx.userDevice.deleteMany() },
    { label: 'UserTerritory', run: (tx) => tx.userTerritory.deleteMany() },
    { label: 'Client', run: (tx) => tx.client.deleteMany() },
    { label: 'AuditLog', run: (tx) => tx.auditLog.deleteMany() },
    { label: 'Territory', run: (tx) => tx.territory.deleteMany() },
    { label: 'PropertyRent', run: (tx) => tx.propertyRent.deleteMany() },
    { label: 'Landlord', run: (tx) => tx.landlord.deleteMany() },
    { label: 'Category', run: (tx) => tx.category.deleteMany() },
  ];

  const results: Array<{ label: string; count: number; countsAsDelete: boolean }> = [];

  for (const step of steps) {
    const result = await step.run(prisma);
    results.push({
      label: step.label,
      count: result.count,
      countsAsDelete: step.countsAsDelete ?? true,
    });
  }

  const totalDeletedRows = results
    .filter((item) => item.countsAsDelete)
    .reduce((sum, item) => sum + item.count, 0);

  console.log('✅ Cleanup completed successfully.');
  console.log(`✅ Preserved models: ${EXCLUDED_MODELS.join(', ')}`);
  console.log('✅ No tables were dropped. No schema/database deletion was performed.');
  console.log('');
  console.log('Operation summary:');
  for (const item of results) {
    const action = item.countsAsDelete ? 'deleted' : 'updated';
    console.log(`- ${item.label}: ${item.count} rows ${action}`);
  }
  console.log(`\nTotal rows deleted: ${totalDeletedRows}`);
}

main()
  .catch((error) => {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
