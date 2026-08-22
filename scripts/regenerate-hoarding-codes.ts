import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

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

interface HoardingRow {
  code: string;
  prefix: string; // First two parts (e.g., "MESA-SA" from "MESA-SA-U")
  fullRow: string[];
  rowIndex: number;
}

async function regenerateHoardingCodes() {
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

  console.log(`📊 Found ${lines.length - 1} data rows\n`);

  // Parse all hoarding rows
  const hoardings: HoardingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      console.warn(`⚠️  Skipping row ${i + 1}: column count mismatch`);
      continue;
    }

    const code = values[codeIndex]?.trim();
    if (!code) {
      console.warn(`⚠️  Skipping row ${i + 1}: empty hoarding code`);
      continue;
    }

    // Extract prefix (first two parts separated by '-')
    const codeParts = code.split('-').filter(p => p.trim());
    let prefix = '';
    if (codeParts.length >= 2 && codeParts[0] && codeParts[1]) {
      prefix = `${codeParts[0]}-${codeParts[1]}`;
    } else {
      prefix = codeParts[0] || code; // Fallback to full code if no dash
    }

    hoardings.push({
      code,
      prefix,
      fullRow: values,
      rowIndex: i,
    });
  }

  console.log(`✅ Parsed ${hoardings.length} hoardings\n`);

  // Group hoardings by prefix
  const prefixGroups = new Map<string, HoardingRow[]>();
  for (const hoarding of hoardings) {
    if (!prefixGroups.has(hoarding.prefix)) {
      prefixGroups.set(hoarding.prefix, []);
    }
    const group = prefixGroups.get(hoarding.prefix);
    if (group) {
      group.push(hoarding);
    }
  }

  console.log(`📦 Found ${prefixGroups.size} unique prefixes\n`);

  // Generate new codes
  // Strategy:
  // 1. Sort prefixes to ensure consistent ordering
  // 2. For each prefix group:
  //    - If group has 1 item: SA-01, SA-02, etc.
  //    - If group has multiple items: SA-01-1, SA-01-2, SA-01-3, etc.
  
  const sortedPrefixes = Array.from(prefixGroups.keys()).sort();
  const rowIndexMapping = new Map<number, string>(); // rowIndex -> new code (handles duplicates)
  const codeToNewCode = new Map<string, string>(); // old code -> new code (for database updates, first occurrence)
  let saCounter = 1;

  for (const prefix of sortedPrefixes) {
    const group = prefixGroups.get(prefix);
    if (!group) continue;
    // Sort by row index first to maintain CSV order, then by code for consistency
    const sortedGroup = group.sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) {
        return a.rowIndex - b.rowIndex;
      }
      return a.code.localeCompare(b.code);
    });

    if (group.length === 1) {
      // Single hoarding: SA-01, SA-02, etc.
      const newCode = `SA-${String(saCounter).padStart(2, '0')}`;
      rowIndexMapping.set(sortedGroup[0].rowIndex, newCode);
      // Only set first occurrence for database mapping
      if (!codeToNewCode.has(sortedGroup[0].code)) {
        codeToNewCode.set(sortedGroup[0].code, newCode);
      }
      console.log(`  Row ${sortedGroup[0].rowIndex + 1}: ${sortedGroup[0].code} → ${newCode}`);
      saCounter++;
    } else {
      // Multiple hoardings with same prefix: SA-01-01, SA-01-02, etc.
      const baseCode = `SA-${String(saCounter).padStart(2, '0')}`;
      for (let i = 0; i < sortedGroup.length; i++) {
        const newCode = `${baseCode}-${String(i + 1).padStart(2, '0')}`;
        rowIndexMapping.set(sortedGroup[i].rowIndex, newCode);
        // Only set first occurrence for database mapping
        if (!codeToNewCode.has(sortedGroup[i].code)) {
          codeToNewCode.set(sortedGroup[i].code, newCode);
        }
        console.log(`  Row ${sortedGroup[i].rowIndex + 1}: ${sortedGroup[i].code} → ${newCode}`);
      }
      saCounter++;
    }
  }

  console.log(`\n✅ Generated ${rowIndexMapping.size} new codes (for ${hoardings.length} hoardings)\n`);

  // Update CSV file
  console.log('📝 Updating CSV file...');
  const updatedLines = [lines[0]]; // Keep header

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      updatedLines.push(lines[i]); // Keep malformed rows as-is
      continue;
    }

    const oldCode = values[codeIndex]?.trim();
    if (!oldCode) {
      updatedLines.push(lines[i]); // Keep rows without codes as-is
      continue;
    }

    // Use row index mapping to handle duplicates correctly
    const newCode = rowIndexMapping.get(i);
    if (newCode) {
      values[codeIndex] = newCode;
      // Reconstruct line (handle quoted fields)
      const updatedLine = values.map((val) => {
        // If value contains comma or quotes, wrap in quotes and escape quotes
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',');
      updatedLines.push(updatedLine);
    } else {
      updatedLines.push(lines[i]); // Keep if no mapping found
    }
  }

  // Write updated CSV
  const backupPath = csvFilePath.replace('.csv', '.backup.csv');
  fs.copyFileSync(csvFilePath, backupPath);
  console.log(`💾 Created backup: ${backupPath}`);

  fs.writeFileSync(csvFilePath, updatedLines.join('\n'), 'utf-8');
  console.log(`✅ Updated CSV file: ${csvFilePath}\n`);

  // Update database
  console.log('🗄️  Updating database...');
  let updatedCount = 0;
  let errorCount = 0;
  const processedCodes = new Set<string>(); // Track which codes we've already updated

  // First, update all unique codes (first occurrence of each old code)
  for (const [oldCode, newCode] of codeToNewCode.entries()) {
    if (processedCodes.has(oldCode)) continue; // Skip if already processed
    processedCodes.add(oldCode);
    
    try {
      // Check if hoarding exists with old code
      const existing = await prisma.hoarding.findUnique({
        where: { code: oldCode },
      });

      if (existing) {
        // Check if new code already exists
        const codeExists = await prisma.hoarding.findUnique({
          where: { code: newCode },
        });

        if (codeExists && codeExists.id !== existing.id) {
          console.warn(`⚠️  Code ${newCode} already exists, skipping ${oldCode}`);
          errorCount++;
          continue;
        }

        // Update the code
        await prisma.hoarding.update({
          where: { code: oldCode },
          data: { code: newCode },
        });
        updatedCount++;
      } else {
        console.warn(`⚠️  Hoarding ${oldCode} not found in database`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error updating ${oldCode} → ${newCode}:`, errorMessage);
      errorCount++;
    }
  }

  // Handle duplicate codes - update remaining occurrences with unique codes
  console.log('\n🔄 Handling duplicate codes in database...');
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    
    const oldCode = values[codeIndex]?.trim();
    if (!oldCode) continue;

    const newCode = rowIndexMapping.get(i);
    if (!newCode) continue;

    // If this code was already processed, we need to handle duplicates
    if (codeToNewCode.get(oldCode) !== newCode) {
      // This is a duplicate - find all hoardings with this code and update them
      try {
        const allHoardingsWithCode = await prisma.hoarding.findMany({
          where: { code: oldCode },
        });

        if (allHoardingsWithCode.length > 1) {
          // Find which one hasn't been updated yet
          const primaryNewCode = codeToNewCode.get(oldCode);
          const alreadyUpdated = allHoardingsWithCode.find(h => h.code === primaryNewCode);
          
          if (!alreadyUpdated) {
            // Update the first one with the primary new code
            await prisma.hoarding.update({
              where: { id: allHoardingsWithCode[0].id },
              data: { code: primaryNewCode || newCode },
            });
            updatedCount++;
          } else {
            // Update remaining ones with their specific new codes
            const remaining = allHoardingsWithCode.filter(h => h.id !== alreadyUpdated.id);
            for (const hoarding of remaining) {
              // Use the new code from the mapping
              await prisma.hoarding.update({
                where: { id: hoarding.id },
                data: { code: newCode },
              });
              updatedCount++;
              console.log(`  Updated duplicate: ${oldCode} (ID: ${hoarding.id}) → ${newCode}`);
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error handling duplicate ${oldCode}:`, errorMessage);
        errorCount++;
      }
    }
  }

  console.log(`\n✅ Database update complete:`);
  console.log(`   Updated: ${updatedCount}`);
  console.log(`   Errors: ${errorCount}`);

  // Generate summary report
  console.log(`\n📊 Summary:`);
  console.log(`   Total hoardings processed: ${hoardings.length}`);
  console.log(`   Unique prefixes: ${prefixGroups.size}`);
  console.log(`   Single hoardings: ${Array.from(prefixGroups.values()).filter(g => g.length === 1).length}`);
  console.log(`   Grouped hoardings: ${Array.from(prefixGroups.values()).filter(g => g.length > 1).length}`);
  console.log(`   New codes generated: ${rowIndexMapping.size}`);
  console.log(`   Database records updated: ${updatedCount}`);
}

regenerateHoardingCodes()
  .catch((e) => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

