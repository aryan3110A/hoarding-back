import recycleBinService from '../services/recycleBin.service';
import { logger } from '../lib/logger';

export async function runRecycleBinPurgeJob() {
  try {
    logger.info('[RecycleBinPurgeJob] Starting auto-purge check...');
    const result = await recycleBinService.autoPurgeOldItems();
    logger.info(`[RecycleBinPurgeJob] Completed. Purged ${result.purgedCount} items.`);
  } catch (err) {
    logger.error('[RecycleBinPurgeJob] Error running auto-purge:', err);
  }
}
