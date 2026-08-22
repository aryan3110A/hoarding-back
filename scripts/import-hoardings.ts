import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

dotenv.config();

const prisma = new PrismaClient();

function assertNotProduction(scriptName: string) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ Refusing to run ${scriptName} in production (NODE_ENV=production).`);
    process.exit(1);
  }
}

function assertDestructiveScriptsAllowed(scriptName: string) {
  if (process.env.ALLOW_DESTRUCTIVE_SCRIPTS !== 'true') {
    console.error(
      `❌ ${scriptName} includes destructive operations. Set ALLOW_DESTRUCTIVE_SCRIPTS=true to allow deletes.`,
    );
    process.exit(1);
  }
}

interface CSVRow {
  'Hoarding Code': string;
  City: string;
  '(Area/Zone)': string;
  'Location / Landmark': string;
  'Facing Direction': string;
  'Size (Width x Height)': string;
  Position: string;
  'Hoarding Type': string;
  Illumination: string;
  Latitude: string;
  Longitude: string;
  Ownership: string;
  'Price per Month': string;
  Status: string;
  'Past Price History': string;
  'Previous Clients': string;
  Rent: string;
  'Payment Mode': string;
  'Contract Period': string;
  'Due Date': string;
  'Landloard Name/Number': string; // legacy
  Landlord: string; // new normalized column
  'Sq. Ft.': string; // new column
}

type CSVRowData = Partial<Record<keyof CSVRow, string>>;

// Use a plain object to be cast to Prisma InputJsonValue when present
type RateHistory = Record<string, unknown>;

function parseSize(sizeStr: string): { widthCm: number | null; heightCm: number | null } {
  if (!sizeStr) return { widthCm: null, heightCm: null };

  // Handle formats like "77 x 10", "20 x 20", etc.
  const match = sizeStr.match(/(\d+)\s*x\s*(\d+)/i);
  if (match) {
    // Assuming the size is in feet, convert to cm (1 ft = 30.48 cm)
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    return {
      widthCm: width * 30.48, // Convert feet to cm
      heightCm: height * 30.48,
    };
  }
  return { widthCm: null, heightCm: null };
}

function parseOwnership(raw: string): string | null {
  if (!raw) return null;
  return raw.trim();
}

function derivePartyType(ownershipText: string | null): string {
  const ow = (ownershipText || '').toLowerCase();
  if (ow.includes('gov')) return 'Government';
  if (ow.includes('friend')) return 'Friend';
  if (ow.includes('private')) return 'Private';
  return 'Private';
}

function deriveLandlord(ownershipText: string | null, landlordCsv?: string | null): string | null {
  const explicit = (landlordCsv || '').trim();
  if (explicit) return explicit;
  const text = (ownershipText || '').trim();
  if (!text) return null;
  // Common pattern: "GOV - R & B Mehsana" => landlord "R & B Mehsana"
  const stripped = text.replace(/^(gov|govt|government)\s*-\s*/i, '').trim();
  if (stripped) return stripped;
  return text;
}

function parseStatus(status: string): string {
  if (!status) return 'available';

  const statusLower = status.toLowerCase();
  if (statusLower.includes('available') || statusLower === '') {
    return 'available';
  }
  if (statusLower.includes('booked') || statusLower.includes('occupied')) {
    return 'occupied';
  }
  return 'available';
}

function parseSide(position: string): string | null {
  if (!position) return null;

  const posUpper = position.toUpperCase();
  if (posUpper.includes('LHS')) return 'LHS';
  if (posUpper.includes('RHS')) return 'RHS';
  return null;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function extractPrefix(code: string): string | null {
  // Extract first two segments: "ABCD-YZ-U" -> "ABCD-YZ"
  const parts = code
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return null;
}

function generateSACode(groupIndex: number, itemIndex: number, isSingleItem: boolean): string {
  // Generate SA-XX or SA-XX-YY format
  // groupIndex: sequential number for the prefix group (SA-35)
  // itemIndex: sequential number within the group (0, 1, 2, etc.)
  // isSingleItem: true if this is the only item in the group

  if (isSingleItem) {
    // Single item in group, use SA-XX format
    return `SA-${String(groupIndex).padStart(2, '0')}`;
  }
  // Multiple items in group, use SA-XX-YY format (01, 02, 03, etc.)
  return `SA-${String(groupIndex).padStart(2, '0')}-${String(itemIndex + 1).padStart(2, '0')}`;
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function deleteAllHoardings(): Promise<void> {
  assertNotProduction('import-hoardings');
  assertDestructiveScriptsAllowed('import-hoardings');
  console.log('\n🗑️  Deleting all existing hoardings and related data...');

  // Get all hoarding IDs first
  const allHoardings = await prisma.hoarding.findMany({
    select: { id: true },
  });

  if (allHoardings.length === 0) {
    console.log('   No hoardings found to delete.');
    return;
  }

  const hoardingIds = allHoardings.map((h) => h.id);

  // Delete in correct order to respect foreign key constraints:
  // 1. BookingToken (references hoardingId)
  const deletedTokens = await prisma.bookingToken.deleteMany({
    where: {
      hoardingId: {
        in: hoardingIds,
      },
    },
  });
  console.log(`   Deleted ${deletedTokens.count} booking token records`);

  // 2. Booking (references hoardingId)
  const deletedBookings = await prisma.booking.deleteMany({
    where: {
      hoardingId: {
        in: hoardingIds,
      },
    },
  });
  console.log(`   Deleted ${deletedBookings.count} booking records`);

  // 3. Rent (references hoardingId)
  const deletedRents = await prisma.rent.deleteMany({
    where: {
      hoardingId: {
        in: hoardingIds,
      },
    },
  });
  console.log(`   Deleted ${deletedRents.count} rent records`);

  // 4. Finally delete the hoardings themselves
  const deletedHoardings = await prisma.hoarding.deleteMany({});
  console.log(`   ✅ Deleted ${deletedHoardings.count} hoardings`);

  console.log('   🎉 All existing hoarding data has been removed.\n');
}

async function importHoardings() {
  assertNotProduction('import-hoardings');
  // Try multiple possible paths
  const possiblePaths = [
    path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), 'frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '../../frontend/_Advertise Master Database - Hoardings.csv'),
  ];

  const csvFilePath = possiblePaths.find((p) => fs.existsSync(p));

  if (!csvFilePath) {
    console.error(`❌ CSV file not found. Tried:`);
    possiblePaths.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  console.log(`📁 Using CSV file: ${csvFilePath}\n`);

  // Ask user if they want to delete existing hoardings
  const existingCount = await prisma.hoarding.count();
  if (existingCount > 0) {
    console.log(`⚠️  Found ${existingCount} existing hoardings in the database.`);
    const answer = await askQuestion(
      'Do you want to DELETE all existing hoarding data before importing? (yes/no): ',
    );

    if (answer === 'yes' || answer === 'y') {
      await deleteAllHoardings();
    } else {
      console.log('   Keeping existing hoardings. New data will be merged/updated.\n');
    }
  }

  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = fileContent.split('\n').filter((line) => line.trim());

  if (lines.length < 2) {
    console.error('❌ CSV file is empty or has no data rows');
    process.exit(1);
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log(`📊 Found ${lines.length - 1} data rows in CSV\n`);

  // Step 1: Read all rows and group by prefix
  interface RowWithPrefix {
    rowIndex: number;
    row: CSVRowData;
    prefix: string | null;
    originalCode: string;
  }

  const rowsWithPrefix: RowWithPrefix[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      continue;
    }

    const row: CSVRowData = {};
    headers.forEach((header, index) => {
      row[header as keyof CSVRow] = values[index] || '';
    });

    const originalCode = row['Hoarding Code']?.trim() || '';
    if (!originalCode) {
      continue;
    }

    const prefix = extractPrefix(originalCode);
    rowsWithPrefix.push({
      rowIndex: i,
      row,
      prefix: prefix || 'UNKNOWN',
      originalCode,
    });
  }

  // Step 2: Group rows by prefix
  const prefixGroups = new Map<string, RowWithPrefix[]>();
  for (const rowData of rowsWithPrefix) {
    const key = rowData.prefix || 'UNKNOWN';
    if (!prefixGroups.has(key)) {
      prefixGroups.set(key, []);
    }
    prefixGroups.get(key)!.push(rowData);
  }

  // Step 3: Generate code mapping
  const codeMapping = new Map<number, string>(); // rowIndex -> newCode
  let groupCounter = 1;

  // Sort prefixes for consistent ordering
  const sortedPrefixes = Array.from(prefixGroups.keys()).sort();

  for (const prefix of sortedPrefixes) {
    const group = prefixGroups.get(prefix)!;
    const isSingleItem = group.length === 1;

    if (isSingleItem) {
      // Single item: SA-XX
      const newCode = generateSACode(groupCounter, 0, true);
      codeMapping.set(group[0].rowIndex, newCode);
    } else {
      // Multiple items: SA-XX-01, SA-XX-02, etc.
      for (let i = 0; i < group.length; i++) {
        const newCode = generateSACode(groupCounter, i, false);
        codeMapping.set(group[i].rowIndex, newCode);
      }
    }

    groupCounter++;
  }

  console.log(`📝 Generated ${codeMapping.size} codes from ${prefixGroups.size} prefix groups\n`);

  // Step 4: Import with generated codes
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) {
        skipped++;
        continue;
      }

      const row: CSVRowData = {};
      headers.forEach((header, index) => {
        row[header as keyof CSVRow] = values[index] || '';
      });

      const originalCode = row['Hoarding Code']?.trim();
      if (!originalCode) {
        skipped++;
        continue;
      }

      // Get the generated code for this row
      const newCode = codeMapping.get(i);
      if (!newCode) {
        skipped++;
        continue;
      }

      const { widthCm, heightCm } = parseSize(row['Size (Width x Height)'] || '');
      const ownership = parseOwnership(row['Ownership'] || '');
      const status = parseStatus(row['Status'] || '');
      const side = parseSide(row['Position'] || '');

      const lat = row['Latitude'] ? parseFloat(row['Latitude']) : null;
      const lng = row['Longitude'] ? parseFloat(row['Longitude']) : null;

      // Check if hoarding with this new code already exists
      const existing = await prisma.hoarding.findUnique({
        where: { code: newCode },
      });

      // Parse illumination
      const illumination = row['Illumination']?.trim() || null;

      // Store additional metadata in rateHistory if available
      const rateHistory: RateHistory = {};
      if (row['Past Price History']) rateHistory.pastPriceHistory = row['Past Price History'];
      if (row['Previous Clients']) rateHistory.previousClients = row['Previous Clients'];
      if (illumination) rateHistory.illumination = illumination;
      const landlordCsv = (row['Landlord'] || row['Landloard Name/Number'] || '').trim();
      const landlordFromOwnership = deriveLandlord(row['Ownership'] || '', landlordCsv);
      if (landlordFromOwnership) rateHistory.landlord = landlordFromOwnership;

      // Store Sq. Ft. if available
      if (row['Sq. Ft.']) {
        rateHistory.sqFt = row['Sq. Ft.'];
      }

      // Preserve any additional CSV columns that are not mapped explicitly
      const knownFields = new Set([
        'Hoarding Code',
        'City',
        '(Area/Zone)',
        'Location / Landmark',
        'Facing Direction',
        'Size (Width x Height)',
        'Position',
        'Hoarding Type',
        'Illumination',
        'Latitude',
        'Longitude',
        'Ownership',
        'Price per Month',
        'Status',
        'Past Price History',
        'Previous Clients',
        'Rent',
        'Payment Mode',
        'Contract Period',
        'Due Date',
        'Landloard Name/Number',
        'Landlord',
        'Sq. Ft.',
      ]);
      const additionalMeta: Record<string, string> = {};
      headers.forEach((header) => {
        const val = (row as CSVRowData)[header as keyof CSVRow] || '';
        if (!knownFields.has(header) && val && val.trim() !== '') {
          additionalMeta[header] = val;
        }
      });
      if (Object.keys(additionalMeta).length > 0) {
        (rateHistory as Record<string, unknown>).additional = additionalMeta;
      }

      // Derive a propertyGroupId from the original hoarding code prefix (first two segments)
      // This helps group related hoardings together
      let propertyGroupId: string | null = null;
      const codeParts = originalCode
        .split('-')
        .map((p) => p.trim())
        .filter(Boolean);
      if (codeParts.length >= 2) {
        const candidateGroupId = `${codeParts[0]}-${codeParts[1]}`;
        const rentExists = await prisma.propertyRent.findUnique({
          where: { propertyGroupId: candidateGroupId },
        });
        if (rentExists) {
          propertyGroupId = candidateGroupId;
        }
      }

      // Build hoarding data
      const hoardingData: Prisma.HoardingUncheckedCreateInput = {
        code: newCode,
        title: row['Location / Landmark'] || null,
        city: row['City'] || null,
        area: row['(Area/Zone)'] || null,
        landmark: row['Location / Landmark'] || null,
        roadName: row['Facing Direction'] || null,
        side: side,
        lat: lat && !isNaN(lat) ? lat : null,
        lng: lng && !isNaN(lng) ? lng : null,
        widthCm: widthCm ? Math.round(widthCm) : null,
        heightCm: heightCm ? Math.round(heightCm) : null,
        type: row['Hoarding Type'] || null,
        ownership: ownership,
        status: status,
        baseRate:
          row['Price per Month'] && row['Price per Month'].trim()
            ? parseFloat(row['Price per Month'])
            : null,
        propertyGroupId,
        ...(Object.keys(rateHistory).length > 0
          ? { rateHistory: rateHistory as Prisma.InputJsonValue }
          : {}),
      };

      let hoardingId: string;

      if (existing) {
        // Update existing (shouldn't happen with new codes, but just in case)
        const updated = await prisma.hoarding.update({
          where: { code: newCode },
          data: hoardingData,
        });
        hoardingId = updated.id;
        imported++;
        if (imported % 50 === 0) {
          console.log(`  Processed ${imported} hoardings...`);
        }
      } else {
        // Create new
        const created = await prisma.hoarding.create({
          data: hoardingData,
        });
        hoardingId = created.id;
        imported++;
        if (imported % 50 === 0) {
          console.log(`  Processed ${imported} hoardings...`);
        }
      }

      // Handle rent data if available
      if (row['Rent'] && row['Payment Mode']) {
        try {
          const rentAmount = parseFloat(row['Rent']);
          if (!isNaN(rentAmount) && rentAmount > 0) {
            const paymentMode = row['Payment Mode'].trim();
            const dueDateStr = row['Due Date']?.trim();

            // Parse due date (try multiple formats)
            let nextDueDate: Date | null = null;
            if (dueDateStr) {
              const parsedDate = new Date(dueDateStr);
              if (!isNaN(parsedDate.getTime())) {
                nextDueDate = parsedDate;
              }
            }

            // Determine party type from ownership text
            const partyType = derivePartyType(ownership);

            // Upsert rent data
            await prisma.rent.upsert({
              where: { hoardingId },
              update: {
                rentAmount,
                paymentMode,
                nextDueDate,
                partyType,
              },
              create: {
                hoardingId,
                rentAmount,
                paymentMode,
                nextDueDate,
                partyType,
              },
            });
          }
        } catch (rentError) {
          // Silently skip rent errors - they're optional
        }
      }
    } catch (error) {
      console.error(`❌ Error importing row ${i + 1}:`, error);
      errors++;
    }
  }

  console.log(`\n✅ Import completed!`);
  console.log(`   Imported/Updated: ${imported}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`\n📊 Total hoardings in database: ${await prisma.hoarding.count()}`);
}

async function main() {
  try {
    await importHoardings();
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
