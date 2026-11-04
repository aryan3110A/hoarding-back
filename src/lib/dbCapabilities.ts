import { prisma } from './prisma';

/**
 * Detects whether the connected database has the Phase-3 blocking schema
 * (BLOCKED / PENDING / EXTENSION_REQUESTED token states + blockedAt etc.).
 *
 * The result used to be hard-coded to `false` to keep an un-migrated database working. In that
 * "legacy" mode every token is a plain ACTIVE row and the queue is only a number, which is exactly
 * what allowed several clients to hold the same hoarding at once. We now detect the real schema:
 * as soon as the migration has been applied the proper queue logic is used automatically.
 *
 * A positive result is cached for the life of the process; a negative one is re-checked every
 * minute so a migration applied while the server is running is picked up without a restart.
 */
const NEGATIVE_RECHECK_MS = 60 * 1000;

let cachedPositive = false;
let lastNegativeCheckAt = 0;
let cachedNegative = false;

export function resetDbCapabilitiesCache() {
  cachedPositive = false;
  cachedNegative = false;
  lastNegativeCheckAt = 0;
}

export async function supportsPhase3BlockingSchema(): Promise<boolean> {
  if (process.env.FORCE_LEGACY_BLOCKING === 'true') return false;
  if (cachedPositive) return true;
  if (cachedNegative && Date.now() - lastNegativeCheckAt < NEGATIVE_RECHECK_MS) return false;

  try {
    const rows = (await prisma.$queryRaw`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'BookingToken'
            AND column_name = 'blockedAt'
        ) AS has_column,
        EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'TokenStatus' AND e.enumlabel = 'BLOCKED'
        ) AS has_enum
    `) as Array<{ has_column: boolean; has_enum: boolean }>;

    const ok = !!rows?.[0]?.has_column && !!rows?.[0]?.has_enum;
    if (ok) {
      cachedPositive = true;
      cachedNegative = false;
    } else {
      cachedNegative = true;
      lastNegativeCheckAt = Date.now();
    }
    return ok;
  } catch (_) {
    cachedNegative = true;
    lastNegativeCheckAt = Date.now();
    return false;
  }
}
