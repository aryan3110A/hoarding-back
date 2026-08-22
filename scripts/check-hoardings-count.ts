import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function checkCounts() {
  try {
    // Count in database
    const dbCount = await prisma.hoarding.count();
    console.log(`📊 Total hoardings in database: ${dbCount}`);

    // Count in CSV
    const csvPath = path.join(process.cwd(), '../frontend/_Advertise Master Database - Hoardings.csv');
    if (fs.existsSync(csvPath)) {
      const fileContent = fs.readFileSync(csvPath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      const csvDataRows = lines.length - 1; // Exclude header
      console.log(`📄 Total data rows in CSV: ${csvDataRows}`);
      console.log(`\nDifference: ${csvDataRows - dbCount} hoardings`);
      
      if (csvDataRows > dbCount) {
        console.log(`\n⚠️  ${csvDataRows - dbCount} entries from CSV are missing in the database.`);
        console.log('This could be due to:');
        console.log('  - Rows with empty hoarding codes (skipped during import)');
        console.log('  - Rows with invalid data format (skipped during import)');
        console.log('  - Duplicate codes that were updated instead of inserted');
      }
    } else {
      console.log('CSV file not found at:', csvPath);
    }

    // Check for duplicate codes in database
    const allHoardings = await prisma.hoarding.findMany({
      select: { code: true },
    });
    const codes = allHoardings.map(h => h.code);
    const uniqueCodes = new Set(codes);
    
    if (codes.length !== uniqueCodes.size) {
      console.log(`\n⚠️  Found ${codes.length - uniqueCodes.size} duplicate codes in database!`);
    } else {
      console.log(`\n✅ All ${codes.length} hoarding codes are unique.`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCounts();

