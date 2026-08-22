import * as fs from 'fs';
import * as path from 'path';

// Type declarations for Node.js globals
declare const process: NodeJS.Process;

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

async function checkSkippedHoardings() {
  // Find CSV file
  const possiblePaths = [
    path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), 'frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '_Advertise Master Database - Hoardings.csv'),
  ];
  const csvFilePath = possiblePaths.find(p => fs.existsSync(p));

  if (!csvFilePath) {
    console.error('❌ CSV file not found');
    process.exit(1);
  }

  console.log(`📁 Reading CSV: ${csvFilePath}\n`);

  // Read and parse CSV
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  
  const codeIndex = headers.findIndex(h => h === 'Hoarding Code');
  if (codeIndex === -1) {
    console.error('❌ "Hoarding Code" column not found in CSV');
    process.exit(1);
  }

  console.log(`📊 Total lines in CSV: ${lines.length}`);
  console.log(`📊 Header row: 1`);
  console.log(`📊 Expected data rows: ${lines.length - 1}\n`);

  const skippedRows: Array<{ row: number; reason: string; data: string }> = [];
  const validRows: Array<{ row: number; code: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const code = values[codeIndex]?.trim();

    if (values.length !== headers.length) {
      skippedRows.push({
        row: i + 1,
        reason: `Column count mismatch: expected ${headers.length}, got ${values.length}`,
        data: lines[i].substring(0, 100) + (lines[i].length > 100 ? '...' : ''),
      });
      continue;
    }

    if (!code) {
      skippedRows.push({
        row: i + 1,
        reason: 'Empty hoarding code',
        data: lines[i].substring(0, 100) + (lines[i].length > 100 ? '...' : ''),
      });
      continue;
    }

    validRows.push({
      row: i + 1,
      code,
    });
  }

  console.log(`✅ Valid hoardings: ${validRows.length}`);
  console.log(`⚠️  Skipped rows: ${skippedRows.length}\n`);

  if (skippedRows.length > 0) {
    console.log('📋 Skipped Rows Details:\n');
    skippedRows.forEach(({ row, reason, data }) => {
      console.log(`Row ${row}: ${reason}`);
      console.log(`  Data: ${data}`);
      console.log('');
    });
  }

  // Check for duplicate codes
  const codeCounts = new Map<string, number[]>();
  validRows.forEach(({ row, code }) => {
    if (!codeCounts.has(code)) {
      codeCounts.set(code, []);
    }
    codeCounts.get(code)!.push(row);
  });

  const duplicates = Array.from(codeCounts.entries()).filter(([, rows]) => rows.length > 1);
  if (duplicates.length > 0) {
    console.log(`\n⚠️  Found ${duplicates.length} duplicate codes:\n`);
    duplicates.forEach(([code, rows]) => {
      console.log(`  Code "${code}" appears in rows: ${rows.join(', ')}`);
    });
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Total CSV rows: ${lines.length - 1}`);
  console.log(`   Valid hoardings: ${validRows.length}`);
  console.log(`   Skipped rows: ${skippedRows.length}`);
  console.log(`   Duplicate codes: ${duplicates.length}`);
  console.log(`   Unique codes: ${codeCounts.size}`);
}

checkSkippedHoardings()
  .catch((e) => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  });


