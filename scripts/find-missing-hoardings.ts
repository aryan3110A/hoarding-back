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

async function findMissing() {
  try {
    // Get all codes from database
    const dbHoardings = await prisma.hoarding.findMany({
      select: { code: true },
    });
    const dbCodes = new Set(dbHoardings.map(h => h.code));
    console.log(`Database has ${dbCodes.size} hoardings\n`);

    // Read CSV
    const csvPath = path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());
    const headers = parseCSVLine(lines[0]);
    
    const codeIndex = headers.indexOf('Hoarding Code');
    if (codeIndex === -1) {
      console.error('Hoarding Code column not found!');
      return;
    }

    const missingCodes: string[] = [];
    const emptyCodes: number[] = [];
    const invalidRows: number[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      
      if (values.length !== headers.length) {
        invalidRows.push(i + 1);
        continue;
      }

      const code = values[codeIndex]?.trim();
      
      if (!code) {
        emptyCodes.push(i + 1);
        continue;
      }

      if (!dbCodes.has(code)) {
        missingCodes.push(code);
        console.log(`Missing: Row ${i + 1}, Code: ${code}`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total CSV rows: ${lines.length - 1}`);
    console.log(`   Missing from DB: ${missingCodes.length}`);
    console.log(`   Empty codes: ${emptyCodes.length}`);
    console.log(`   Invalid rows: ${invalidRows.length}`);

    if (emptyCodes.length > 0) {
      console.log(`\n⚠️  Rows with empty codes: ${emptyCodes.join(', ')}`);
    }
    if (invalidRows.length > 0) {
      console.log(`\n⚠️  Rows with invalid format: ${invalidRows.join(', ')}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findMissing();

