import * as fs from 'fs';
import * as path from 'path';

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

async function checkMissingLandlords() {
  // Find CSV file
  const possiblePaths = [
    path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), 'frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '../../frontend/_Advertise Master Database - Hoardings.csv'),
  ];

  const csvFilePath = possiblePaths.find((p) => fs.existsSync(p));

  if (!csvFilePath) {
    console.error('❌ CSV file not found. Tried:');
    possiblePaths.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  console.log(`📁 Reading CSV: ${csvFilePath}\n`);

  // Read and parse CSV
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = fileContent.split('\n').filter((line) => line.trim());

  if (lines.length < 2) {
    console.error('❌ CSV file is empty or has no data rows');
    process.exit(1);
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const codeIndex = headers.findIndex((h) => h === 'Hoarding Code');
  const cityIndex = headers.findIndex((h) => h === 'City');
  const areaIndex = headers.findIndex((h) => h === '(Area/Zone)' || h === 'Area/Zone');
  const locationIndex = headers.findIndex((h) => h === 'Location / Landmark');
  const landlordIndex = headers.findIndex((h) => h === 'Landlord');
  const landlordLegacyIndex = headers.findIndex((h) => h === 'Landloard Name/Number');
  const ownershipIndex = headers.findIndex((h) => h === 'Ownership');

  if (codeIndex === -1) {
    console.error('❌ "Hoarding Code" column not found');
    process.exit(1);
  }

  console.log(`📊 Analyzing ${lines.length - 1} rows...\n`);

  interface MissingLandlordInfo {
    row: number;
    code: string;
    city?: string;
    area?: string;
    location?: string;
    ownership?: string;
    landlord?: string;
    landlordLegacy?: string;
  }

  const missingLandlords: MissingLandlordInfo[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      continue;
    }

    const code = values[codeIndex]?.trim();
    if (!code) {
      continue;
    }

    const landlord = landlordIndex >= 0 ? values[landlordIndex]?.trim() : '';
    const landlordLegacy = landlordLegacyIndex >= 0 ? values[landlordLegacyIndex]?.trim() : '';
    const ownership = ownershipIndex >= 0 ? values[ownershipIndex]?.trim() : '';

    // Check if landlord is missing (both new and legacy columns)
    const hasLandlord = landlord && landlord.length > 0;
    const hasLandlordLegacy = landlordLegacy && landlordLegacy.length > 0;

    if (!hasLandlord && !hasLandlordLegacy) {
      // Check if ownership might contain landlord info (e.g., "GOV - R & B Mehsana")
      const ownershipHasInfo = ownership && ownership.trim().length > 0;

      missingLandlords.push({
        row: i + 1,
        code,
        city: cityIndex >= 0 ? values[cityIndex]?.trim() : undefined,
        area: areaIndex >= 0 ? values[areaIndex]?.trim() : undefined,
        location: locationIndex >= 0 ? values[locationIndex]?.trim() : undefined,
        ownership: ownershipHasInfo ? ownership : undefined,
        landlord: landlord || undefined,
        landlordLegacy: landlordLegacy || undefined,
      });
    }
  }

  if (missingLandlords.length === 0) {
    console.log('✅ All hoardings have landlord information!\n');
    return;
  }

  console.log(`⚠️  Found ${missingLandlords.length} hoarding(s) with missing landlord information:\n`);
  console.log('═'.repeat(100));

  // Group by city for better readability
  const byCity = new Map<string, MissingLandlordInfo[]>();
  for (const item of missingLandlords) {
    const city = item.city || 'Unknown';
    if (!byCity.has(city)) {
      byCity.set(city, []);
    }
    byCity.get(city)!.push(item);
  }

  const sortedCities = Array.from(byCity.keys()).sort();

  for (const city of sortedCities) {
    const items = byCity.get(city)!;
    console.log(`\n📍 ${city} (${items.length} missing)`);
    console.log('─'.repeat(100));

    for (const item of items) {
      console.log(`\n  Row ${item.row}: ${item.code}`);
      if (item.area) {
        console.log(`    Area: ${item.area}`);
      }
      if (item.location) {
        const location = item.location.length > 60 ? item.location.substring(0, 60) + '...' : item.location;
        console.log(`    Location: ${location}`);
      }
      if (item.ownership) {
        console.log(`    Ownership: ${item.ownership}`);
      }
      if (!item.ownership || !item.ownership.toLowerCase().includes('gov')) {
        console.log(`    ⚠️  No landlord AND no ownership info`);
      }
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log(`\n📊 Summary:`);
  console.log(`   Total rows analyzed: ${lines.length - 1}`);
  console.log(`   Missing landlords: ${missingLandlords.length}`);
  console.log(`   Percentage: ${((missingLandlords.length / (lines.length - 1)) * 100).toFixed(2)}%`);

  // Count by city
  console.log(`\n📋 Missing by City:`);
  for (const city of sortedCities) {
    const count = byCity.get(city)!.length;
    console.log(`   ${city}: ${count}`);
  }
}

checkMissingLandlords()
  .catch((e) => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  });

