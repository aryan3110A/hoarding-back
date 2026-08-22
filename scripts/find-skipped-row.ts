import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

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

async function findSkippedRow() {
  const possiblePaths = [
    path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), 'frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '_Advertise Master Database - Hoardings.csv'),
  ];
  const csvFilePath = possiblePaths.find(p => fs.existsSync(p));

  if (!csvFilePath) {
    console.error('CSV file not found');
    process.exit(1);
  }

  console.log(`📁 Reading CSV: ${csvFilePath}\n`);

  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const expectedColumnCount = headers.length;

  console.log(`📊 Total rows: ${lines.length - 1}`);
  console.log(`📊 Expected columns: ${expectedColumnCount}\n`);

  const dbCodes = new Set(
    (await prisma.hoarding.findMany({ select: { code: true } })).map(h => h.code)
  );

  const skippedRows: Array<{ lineNumber: number; code?: string; reason: string; values: string[] }> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const code = values[0]?.trim();

    if (values.length !== expectedColumnCount) {
      skippedRows.push({
        lineNumber: i + 1,
        code: code || undefined,
        reason: `Column count mismatch: expected ${expectedColumnCount}, got ${values.length}`,
        values,
      });
    } else if (!code) {
      skippedRows.push({
        lineNumber: i + 1,
        reason: 'Empty hoarding code',
        values,
      });
    }
  }

  if (skippedRows.length > 0) {
    console.log(`⚠️  Found ${skippedRows.length} skipped row(s):\n`);
    skippedRows.forEach(({ lineNumber, code, reason, values }) => {
      console.log(`Line ${lineNumber}:`);
      if (code) console.log(`  Code: ${code}`);
      console.log(`  Reason: ${reason}`);
      console.log(`  Column count: ${values.length}`);
      console.log(`  First few values: ${values.slice(0, 3).join(', ')}...`);
      console.log(`  Raw line preview: ${lines[lineNumber - 1].substring(0, 100)}...`);
      console.log('');
    });

    // Check if any skipped codes exist in DB
    const skippedCodes = skippedRows.map(r => r.code).filter(Boolean) as string[];
    if (skippedCodes.length > 0) {
      const foundInDb = skippedCodes.filter(code => dbCodes.has(code));
      if (foundInDb.length > 0) {
        console.log(`\n✅ Note: Some skipped codes exist in DB (may have been imported from another row):`);
        foundInDb.forEach(code => console.log(`  - ${code}`));
      }
    }
  } else {
    console.log('✅ No skipped rows found');
  }

  // Also check for rows with newlines in quoted fields
  console.log('\n🔍 Checking for malformed CSV rows (newlines in quoted fields)...\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let inQuotes = false;
    let quoteCount = 0;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
        quoteCount++;
      }
    }
    // If we have an odd number of quotes, the field might span multiple lines
    if (quoteCount % 2 !== 0) {
      const values = parseCSVLine(line);
      const code = values[0]?.trim();
      console.log(`⚠️  Line ${i + 1} (Code: ${code || 'N/A'}) has unmatched quotes - may be split across lines`);
      console.log(`   Preview: ${line.substring(0, 150)}...`);
      console.log('');
    }
  }
}

findSkippedRow()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

