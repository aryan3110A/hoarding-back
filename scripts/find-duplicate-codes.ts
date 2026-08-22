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

async function findDuplicateCodes() {
  // Find CSV file (check backup first, then current)
  const possiblePaths = [
    path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.backup.csv'),
    path.join(process.cwd(), 'frontend/_Advertise Master Database - Hoardings.backup.csv'),
    path.join(process.cwd(), '_Advertise Master Database - Hoardings.backup.csv'),
    path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), 'frontend/_Advertise Master Database - Hoardings.csv'),
    path.join(process.cwd(), '_Advertise Master Database - Hoardings.csv'),
  ];
  const csvFilePath = possiblePaths.find(p => fs.existsSync(p));
  
  const isBackup = csvFilePath?.includes('.backup.csv');

  if (!csvFilePath) {
    console.error('❌ CSV file not found');
    process.exit(1);
  }

  console.log(`📁 Reading CSV: ${csvFilePath}`);
  if (isBackup) {
    console.log(`   (Using backup file - original codes)\n`);
  } else {
    console.log(`   (Using current file - may have new codes)\n`);
  }

  // Read and parse CSV
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  
  const codeIndex = headers.findIndex(h => h === 'Hoarding Code');
  if (codeIndex === -1) {
    console.error('❌ "Hoarding Code" column not found in CSV');
    process.exit(1);
  }

  // Find city index for context
  const cityIndex = headers.findIndex(h => h === 'City');
  const areaIndex = headers.findIndex(h => h === '(Area/Zone)' || h === 'Area/Zone');

  console.log(`📊 Analyzing ${lines.length - 1} rows...\n`);

  // Track codes and their occurrences
  const codeOccurrences = new Map<string, Array<{ row: number; city?: string; area?: string; fullRow: string[] }>>();

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      continue;
    }

    const code = values[codeIndex]?.trim();
    if (!code) {
      continue;
    }

    const city = cityIndex >= 0 ? values[cityIndex]?.trim() : undefined;
    const area = areaIndex >= 0 ? values[areaIndex]?.trim() : undefined;

    if (!codeOccurrences.has(code)) {
      codeOccurrences.set(code, []);
    }
    codeOccurrences.get(code)!.push({
      row: i + 1,
      city,
      area,
      fullRow: values,
    });
  }

  // Find duplicates
  const duplicates = Array.from(codeOccurrences.entries())
    .filter(([, occurrences]) => occurrences.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (duplicates.length === 0) {
    console.log('✅ No duplicate codes found!\n');
    return;
  }

  console.log(`⚠️  Found ${duplicates.length} duplicate code(s):\n`);
  console.log('═'.repeat(80));

  duplicates.forEach(([code, occurrences], index) => {
    console.log(`\n${index + 1}. Code: "${code}"`);
    console.log(`   Appears ${occurrences.length} time(s):\n`);
    
    occurrences.forEach((occ, occIndex) => {
      console.log(`   ${occIndex + 1}. Row ${occ.row}:`);
      if (occ.city) {
        console.log(`      City: ${occ.city}`);
      }
      if (occ.area) {
        console.log(`      Area: ${occ.area}`);
      }
      // Show first few columns for context
      const landmarkIndex = headers.findIndex(h => h === 'Location / Landmark');
      if (landmarkIndex >= 0 && occ.fullRow[landmarkIndex]) {
        const landmark = occ.fullRow[landmarkIndex].substring(0, 60);
        console.log(`      Location: ${landmark}${occ.fullRow[landmarkIndex].length > 60 ? '...' : ''}`);
      }
    });
    console.log('─'.repeat(80));
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Total unique codes: ${codeOccurrences.size}`);
  console.log(`   Duplicate codes: ${duplicates.length}`);
  console.log(`   Total rows with duplicates: ${duplicates.reduce((sum, [, occs]) => sum + occs.length, 0)}`);
  console.log(`   Extra rows (duplicates): ${duplicates.reduce((sum, [, occs]) => sum + occs.length - 1, 0)}`);
}

findDuplicateCodes()
  .catch((e) => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  });

