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

async function checkDuplicates() {
  const csvPath = path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  
  const codeIndex = headers.indexOf('Hoarding Code');
  const codes: string[] = [];
  const codeToRows: Map<string, number[]> = new Map();

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    
    const code = values[codeIndex]?.trim();
    if (!code) continue;
    
    codes.push(code);
    if (!codeToRows.has(code)) {
      codeToRows.set(code, []);
    }
    codeToRows.get(code)!.push(i + 1);
  }

  // Find duplicates
  const duplicates = Array.from(codeToRows.entries()).filter(([_, rows]) => rows.length > 1);
  
  console.log(`📊 CSV Analysis:`);
  console.log(`   Total rows with codes: ${codes.length}`);
  console.log(`   Unique codes: ${codeToRows.size}`);
  console.log(`   Duplicate codes: ${duplicates.length}\n`);

  if (duplicates.length > 0) {
    console.log(`⚠️  Found ${duplicates.length} duplicate codes in CSV:\n`);
    duplicates.forEach(([code, rows]) => {
      console.log(`   Code: ${code} appears in rows: ${rows.join(', ')}`);
    });
    console.log(`\nNote: Duplicate codes will update existing hoardings instead of creating new ones.`);
    console.log(`This explains why you have ${codes.length - duplicates.length} hoardings instead of ${codes.length}.`);
  } else {
    console.log(`✅ All codes in CSV are unique.`);
    console.log(`\nThe difference of ${codes.length - 567} = ${codes.length - 567} hoardings might be due to:`);
    console.log(`  - Rows that were skipped during import for other reasons`);
    console.log(`  - Or the import was run multiple times and some were updated`);
  }
}

checkDuplicates();

