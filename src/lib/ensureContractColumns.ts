import { prisma } from './prisma';

export async function ensureContractDenormColumns(): Promise<void> {
  try {
    // Try a couple of likely table name variants (Prisma may create lowercased names)
    const candidates = ['Contract', 'contract'];
    let tableFound: string | null = null;
    for (const t of candidates) {
      const rows: any = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_name = '${t}' LIMIT 1`,
      );
      if (Array.isArray(rows) && rows.length > 0) {
        tableFound = t;
        break;
      }
    }

    if (!tableFound) {
      console.warn('ensureContractDenormColumns: contract table not found, skipping');
      return;
    }

    const ensureCol = async (col: string) => {
      const res: any = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_name = '${tableFound}' AND column_name = '${col}' LIMIT 1`,
      );
      if (!(Array.isArray(res) && res.length > 0)) {
        // Add column as text (nullable)
        await prisma.$executeRawUnsafe(`ALTER TABLE "${tableFound}" ADD COLUMN "${col}" text`);
        console.info(`ensureContractDenormColumns: added column ${col} to ${tableFound}`);
      }
    };

    await ensureCol('clientName');
    await ensureCol('hoardingCode');
  } catch (err) {
    // Do not throw — migration helper should be best-effort and not crash startup
    console.warn('ensureContractDenormColumns: failed', err);
  }
}
