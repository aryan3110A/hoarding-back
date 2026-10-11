import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

const CSV_PATH = path.resolve(
  'C:/Users/Admin/Desktop/Shubham Advertise/Hoarding data/Hoarding Database Final Entry - Sheet1 (2).csv',
);

const MISSING_LANDLORD = new Set([
  '',
  '-',
  'n/a',
  'na',
  'none',
  'null',
  'not avilable',
  'not available',
  'not avaliable',
  'unavailable',
]);

type ParsedRow = {
  code: string;
  landlordName: string | null;
  city: string | null;
  category: string | null;
  landmark: string | null;
  roadName: string | null;
  widthFt: number | null;
  heightFt: number | null;
  side: string | null;
  type: string | null;
  lat: number | null;
  lng: number | null;
  ownership: string | null;
  status: string;
  standardRate: number;
  minimumRate: number;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[₹,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function feetToCm(feet: number | null): number | null {
  if (feet == null) return null;
  return Math.round(feet * 30.48);
}

function normalizeLandlord(raw: string | undefined): string | null {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (MISSING_LANDLORD.has(name.toLowerCase())) return null;
  return name;
}

function fillForwardLandlords(rows: ParsedRow[]): void {
  let current: string | null = null;
  for (const row of rows) {
    if (row.landlordName) {
      current = row.landlordName;
    } else {
      row.landlordName = current;
    }
  }
}

async function deleteExistingInventory(): Promise<void> {
  console.log('Deleting existing hoarding inventory and related records...');

  const counts = await prisma.$transaction([
    prisma.billingEvent.deleteMany(),
    prisma.rateApprovalRequest.deleteMany(),
    prisma.inquiryHoarding.deleteMany(),
    prisma.hoardingMaintenance.deleteMany(),
    prisma.supervisorChecklist.deleteMany(),
    prisma.hoardingRenewal.deleteMany(),
    prisma.proposalHoarding.deleteMany(),
    prisma.bookingToken.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.rent.deleteMany(),
    prisma.deletedHoarding.deleteMany(),
    prisma.contract.deleteMany(),
  ]);

  console.log('Related rows cleared:', {
    billingEvents: counts[0].count,
    rateApprovals: counts[1].count,
    inquiryHoardings: counts[2].count,
    maintenance: counts[3].count,
    checklists: counts[4].count,
    renewals: counts[5].count,
    proposalHoardings: counts[6].count,
    tokens: counts[7].count,
    bookings: counts[8].count,
    rents: counts[9].count,
    deletedHoardings: counts[10].count,
    contracts: counts[11].count,
  });

  await prisma.hoarding.updateMany({ data: { propertyGroupId: null, landlordId: null, categoryId: null } });
  const hoardings = await prisma.hoarding.deleteMany();
  const landlords = await prisma.landlord.deleteMany();
  const propertyRents = await prisma.propertyRent.deleteMany();

  console.log(`Deleted ${hoardings.count} hoardings, ${landlords.count} landlords, ${propertyRents.count} property rents`);
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found: ${CSV_PATH}`);
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const table = parseCsv(raw);
  if (table.length < 2) throw new Error('CSV has no data rows');

  const header = table[0].map((h) => h.replace(/^\uFEFF/, ''));
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const col = {
    code: idx('Hoarding Code'),
    landlord: idx('Landlord'),
    city: idx('City'),
    category: idx('Category'),
    location: idx('Location Name'),
    facing: idx('Facing Direction'),
    width: idx('Width (ft)'),
    height: idx('Height (ft)'),
    side: idx('Side (LHS/RHS)'),
    type: idx('Hoarding Type'),
    lat: idx('Latitude'),
    lng: idx('Longitude'),
    ownership: idx('Ownership'),
    status: idx('Status'),
    standard: idx('Standard Rate (₹/month)'),
    minimum: idx('Minimum Rate (₹/month)'),
  };

  if (col.code < 0 || col.landlord < 0) {
    throw new Error(`Unexpected CSV headers: ${header.join(' | ')}`);
  }

  const rows: ParsedRow[] = [];
  for (const cells of table.slice(1)) {
    const code = String(cells[col.code] || '').trim();
    if (!code) continue;
    rows.push({
      code,
      landlordName: normalizeLandlord(cells[col.landlord]),
      city: cells[col.city]?.trim() || null,
      category: cells[col.category]?.trim() || null,
      landmark: cells[col.location]?.trim() || null,
      roadName: cells[col.facing]?.trim() || null,
      widthFt: toNumber(cells[col.width]),
      heightFt: toNumber(cells[col.height]),
      side: cells[col.side]?.trim() || null,
      type: cells[col.type]?.trim() || null,
      lat: toNumber(cells[col.lat]),
      lng: toNumber(cells[col.lng]),
      ownership: cells[col.ownership]?.trim() || null,
      status: (cells[col.status]?.trim() || 'available').toLowerCase(),
      standardRate: toNumber(cells[col.standard]) || 0,
      minimumRate: toNumber(cells[col.minimum]) || 0,
    });
  }

  fillForwardLandlords(rows);

  const seenCodes = new Map<string, number>();
  for (const row of rows) {
    if (!seenCodes.has(row.code)) {
      seenCodes.set(row.code, 1);
      continue;
    }
    const sibling = row.code.replace(/-2$/, '-1');
    let next = sibling !== row.code && !seenCodes.has(sibling) ? sibling : `${row.code}-${String(row.side || 'DUP').toUpperCase()}`;
    let n = 2;
    while (seenCodes.has(next)) {
      next = `${row.code}-DUP${n}`;
      n += 1;
    }
    console.log(`Duplicate code ${row.code} (${row.side || 'no side'}) renamed to ${next}`);
    row.code = next;
    seenCodes.set(next, 1);
  }

  const uniqueLandlords = [...new Set(rows.map((r) => r.landlordName).filter((n): n is string => !!n))];
  console.log(`Parsed ${rows.length} hoardings and ${uniqueLandlords.length} landlords from CSV`);

  await deleteExistingInventory();

  const landlordIds = new Map<string, string>();
  for (const name of uniqueLandlords) {
    const created = await prisma.landlord.create({ data: { name } });
    landlordIds.set(name, created.id);
  }
  console.log(`Created ${landlordIds.size} landlords`);

  const baseTime = Date.now();
  const payload = rows.map((row, index) => ({
    code: row.code,
    title: row.landmark,
    city: row.city,
    area: row.city,
    landmark: row.landmark,
    roadName: row.roadName,
    side: row.side,
    lat: row.lat,
    lng: row.lng,
    widthCm: feetToCm(row.widthFt),
    heightCm: feetToCm(row.heightFt),
    type: row.type,
    ownership: row.ownership,
    status: row.status.includes('book') || row.status.includes('occup') ? 'occupied' : 'available',
    standardRate: row.standardRate,
    minimumRate: row.minimumRate,
    baseRate: row.standardRate,
    landlordId: row.landlordName ? landlordIds.get(row.landlordName) || null : null,
    createdAt: new Date(baseTime + index),
    updatedAt: new Date(baseTime + index),
  }));

  const CHUNK = 100;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    await prisma.hoarding.createMany({ data: slice });
    console.log(`Inserted ${Math.min(i + CHUNK, payload.length)} / ${payload.length}`);
  }

  const [hoardingCount, landlordCount] = await Promise.all([
    prisma.hoarding.count(),
    prisma.landlord.count(),
  ]);

  const himmatnagar = await prisma.hoarding.findMany({
    where: { code: { in: ['SA24', 'SA25', 'SA34', 'SA35'] } },
    include: { landlord: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\nImport complete');
  console.log({ hoardingCount, landlordCount });
  console.log(
    'Landlord check:',
    himmatnagar.map((h) => ({ code: h.code, landlord: h.landlord?.name || null })),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
