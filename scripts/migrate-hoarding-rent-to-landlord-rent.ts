import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

type LegacyRentRow = {
  id: string;
  rentAmount: Prisma.Decimal;
  paymentMode: string;
  lastPaymentDate: Date | null;
  hoardingId: string;
  hoarding: {
    id: string;
    code: string;
    ownership: string | null;
    rateHistory: unknown;
  };
};

function normalizeLandlordName(hoarding: LegacyRentRow['hoarding']): string {
  const history = hoarding.rateHistory as
    | { landlord?: string; landlordName?: string }
    | null
    | undefined;
  const fromHistory =
    history && typeof history === 'object'
      ? String(history.landlord || history.landlordName || '').trim()
      : '';
  if (fromHistory) return fromHistory;

  const ownership = String(hoarding.ownership || '');
  const match = ownership.match(/^(gov|govt|government)\s*-\s*(.+)$/i);
  if (match && match[2]) return String(match[2]).trim();

  return 'Unknown';
}

function slugify(input: string) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (slug || 'unknown_landlord').slice(0, 80);
}

function toFrequency(paymentMode: string): 'Monthly' | 'Quarterly' | 'HalfYearly' | 'Yearly' {
  const value = String(paymentMode || '').toLowerCase();
  if (value === 'quarterly') return 'Quarterly';
  if (value === 'half-yearly' || value === 'halfyearly') return 'HalfYearly';
  if (value === 'yearly') return 'Yearly';
  return 'Monthly';
}

function addMonthsClamped(base: Date, months: number) {
  const next = new Date(base);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() < day) next.setDate(0);
  return next;
}

function nextDueFromStart(
  startDate: Date,
  frequency: 'Monthly' | 'Quarterly' | 'HalfYearly' | 'Yearly',
) {
  const months =
    frequency === 'Monthly'
      ? 1
      : frequency === 'Quarterly'
        ? 3
        : frequency === 'HalfYearly'
          ? 6
          : 12;
  let due = addMonthsClamped(startDate, months);
  const now = new Date();
  while (due.getTime() <= now.getTime()) {
    due = addMonthsClamped(due, months);
  }
  return due;
}

async function main() {
  const legacyRents = (await prisma.rent.findMany({
    include: {
      hoarding: {
        select: { id: true, code: true, ownership: true, rateHistory: true },
      },
    },
  })) as LegacyRentRow[];

  if (!legacyRents.length) {
    console.log('No legacy hoarding-level rent rows found.');
    return;
  }

  const grouped = new Map<string, LegacyRentRow[]>();
  for (const row of legacyRents) {
    const landlord = normalizeLandlordName(row.hoarding);
    if (!grouped.has(landlord)) grouped.set(landlord, []);
    const rowsForLandlord = grouped.get(landlord);
    if (rowsForLandlord) {
      rowsForLandlord.push(row);
    }
  }

  let migratedCount = 0;
  for (const [landlord, rows] of grouped.entries()) {
    const sorted = [...rows].sort((a, b) => {
      const aTime = a.lastPaymentDate ? new Date(a.lastPaymentDate).getTime() : 0;
      const bTime = b.lastPaymentDate ? new Date(b.lastPaymentDate).getTime() : 0;
      return bTime - aTime;
    });
    const canonical = sorted[0];

    const uniqueAmounts = Array.from(new Set(rows.map((r) => Number(r.rentAmount))));
    if (uniqueAmounts.length > 1) {
      console.warn(
        `Landlord ${landlord} has multiple rent amounts (${uniqueAmounts.join(', ')}). Using latest row amount ${Number(canonical.rentAmount)}.`,
      );
    }

    const frequency = toFrequency(canonical.paymentMode);
    const startDate = canonical.lastPaymentDate ? new Date(canonical.lastPaymentDate) : new Date();
    const nextDueDate = nextDueFromStart(startDate, frequency);
    const propertyGroupId = `LANDLORD_${slugify(landlord)}`;

    const existing = await prisma.propertyRent.findFirst({
      where: {
        landlord: {
          equals: landlord,
          mode: 'insensitive',
        },
      },
    });

    const payload = {
      propertyGroupId,
      landlord,
      location: null,
      rentAmount: new Prisma.Decimal(Number(canonical.rentAmount)),
      incrementCycleYears: 1,
      incrementRate: new Prisma.Decimal(0.1),
      paymentFrequency: frequency,
      lastPaymentDate: canonical.lastPaymentDate,
      nextDueDate,
      reminderDays: [14],
      baseRent: new Prisma.Decimal(Number(canonical.rentAmount)),
      rentStartDate: startDate,
      incrementType: 'PERCENTAGE' as const,
      incrementValue: new Prisma.Decimal(10),
      lastIncrementDate: null,
      nextIncrementDate: null,
    };

    if (existing) {
      await prisma.propertyRent.update({ where: { id: existing.id }, data: payload });
    } else {
      await prisma.propertyRent.create({ data: payload });
    }

    migratedCount++;
  }

  console.log(`Migrated/updated landlord rent records: ${migratedCount}`);
  console.log('Legacy hoarding-level Rent rows are preserved for audit.');
  console.log('Hoarding operational statuses were not modified.');
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
