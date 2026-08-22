import app from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { getRedis } from './lib/redis';
import { cleanupSessions } from './jobs/sessionCleanup.job';
import { ReminderJob } from './jobs/reminder.job';
import { startBookingTokenExpiryJob } from './jobs/bookingTokenExpiry.job';
import { ensureContractDenormColumns } from './lib/ensureContractColumns';
import { runContractExpiryJob } from './jobs/contractExpiry.job';
import { runRecycleBinPurgeJob } from './jobs/recycleBin.job';

export const startServer = async () => {
  try {
    // Test Database Connection
    await prisma.$connect();
    logger.info('Database connected');

    // Ensure denormalized contract columns exist so future writes include them
    await ensureContractDenormColumns();

    // Redis connection is handled in lib/redis.ts events; quick check when enabled
    const redis = getRedis();
    if (redis) {
      try {
        await Promise.race([
          redis.ping(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Redis ping timeout')), 1500),
          ),
        ]);
        logger.info('Redis connected (ping)');
      } catch (err) {
        logger.warn('Redis enabled but ping failed, continuing without Redis');
      }
    } else {
      logger.info('Redis disabled, skipping ping');
    }

    // Start Session Cleanup Job (Run every hour)
    setInterval(
      () => {
        cleanupSessions().catch((err) => logger.error('Session cleanup error:', err));
      },
      60 * 60 * 1000,
    );

    // Start Rent Reminder Job (Run every 24 hours)
    const reminderJob = new ReminderJob();
    // Run immediately on startup for demo purposes, then every 24 hours
    reminderJob
      .sendRentReminders()
      .catch((err) => logger.error('Initial rent reminder job error:', err));
    reminderJob
      .sendInvoiceReminders()
      .catch((err) => logger.error('Initial invoice reminder job error:', err));

    setInterval(
      () => {
        reminderJob
          .sendRentReminders()
          .catch((err) => logger.error('Rent reminder job error:', err));
        reminderJob
          .sendInvoiceReminders()
          .catch((err) => logger.error('Invoice reminder job error:', err));
      },
      24 * 60 * 60 * 1000,
    );

    // Start Booking Token Expiry/Promotion Job (every 5 minutes)
    startBookingTokenExpiryJob(5);

    // Start Contract Expiry Job (run daily)
    // Run immediately once, then every 24 hours
    runContractExpiryJob().catch((err) => logger.error('Initial contract expiry job error:', err));
    setInterval(
      () => {
        runContractExpiryJob().catch((err) => logger.error('Contract expiry job error:', err));
      },
      24 * 60 * 60 * 1000,
    );

    // Start Recycle Bin auto-purge job (run daily)
    runRecycleBinPurgeJob().catch((err) => logger.error('Initial recycle bin purge job error:', err));
    setInterval(
      () => {
        runRecycleBinPurgeJob().catch((err) => logger.error('Recycle bin purge job error:', err));
      },
      24 * 60 * 60 * 1000,
    );

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};
