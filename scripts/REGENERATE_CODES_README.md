# Hoarding Code Regeneration Script

## Overview

This script regenerates hoarding codes in the CSV file and database to use the new `SA-XX` format, with intelligent grouping for hoardings that share the same prefix.

## How It Works

### Code Generation Logic

1. **Extract Prefix**: For each hoarding code, extract the first two parts separated by `-`
   - Example: `MESA-SA-U` → prefix: `MESA-SA`
   - Example: `MESH-AH-LU` → prefix: `MESH-AH`

2. **Group by Prefix**: All hoardings with the same prefix are grouped together

3. **Generate New Codes**:
   - **Single hoardings** (no other hoarding shares the prefix):
     - Format: `SA-01`, `SA-02`, `SA-03`, etc.
   
   - **Grouped hoardings** (multiple hoardings share the same prefix):
     - Format: `SA-01-01`, `SA-01-02`, `SA-01-03`, etc.
     - Example:
       - `MESA-SA-U` → `SA-01-01`
       - `MESA-SA-D` → `SA-01-02`
     - Example:
       - `MESH-AH-LU` → `SA-02-01`
       - `MESH-AH-LD` → `SA-02-02`
       - `MESH-AH-S` → `SA-02-03`

### Examples

**Before:**
```
MESA-SA-U
MESA-SA-D
MESH-AH-LU
MESH-AH-LD
MESH-AH-S
MENG-AH-S
```

**After:**
```
SA-01-01  (MESA-SA-U)
SA-01-02  (MESA-SA-D)
SA-02-01  (MESH-AH-LU)
SA-02-02  (MESH-AH-LD)
SA-02-03  (MESH-AH-S)
SA-03     (MENG-AH-S - single, no grouping)
```

## Usage

```bash
cd hoarding
npm run regenerate:codes
```

## What the Script Does

1. **Reads CSV File**: Parses `_Advertise Master Database - Hoardings.csv`
2. **Groups Hoardings**: Groups by prefix (first two parts of code)
3. **Generates New Codes**: Creates `SA-XX` format codes
4. **Creates Backup**: Saves original CSV as `.backup.csv`
5. **Updates CSV**: Writes new codes to CSV file
6. **Updates Database**: Updates all hoarding codes in PostgreSQL database

## Safety Features

- ✅ Creates backup before modifying CSV
- ✅ Validates all codes before updating
- ✅ Checks for duplicate codes in database
- ✅ Skips rows with missing or invalid codes
- ✅ Provides detailed logging and summary

## Output

The script provides:
- Progress updates during execution
- Code mapping (old → new)
- Summary statistics
- Error reporting

## Important Notes

⚠️ **This operation is irreversible** (except via backup file)

⚠️ **Make sure to backup your database** before running

⚠️ **Test on a copy first** if you're unsure

## Troubleshooting

- If a code already exists in the database, the script will skip it and warn you
- If a hoarding is not found in the database, it will be skipped
- Malformed CSV rows are preserved as-is


