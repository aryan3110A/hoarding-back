import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export class SessionCleanupJob {
    async cleanupExpiredSessions() {
        logger.info('Running Session Cleanup Job...');
        const now = new Date();

        const result = await prisma.refreshSession.deleteMany({
            where: {
                OR: [
                    { expiresAt: { lt: now } },
                    { revoked: true }, // Optional: keep revoked for audit? Spec doesn't say. Let's delete for cleanup.
                    { inactivityExpiresAt: { lt: now } }
                ]
            }
        });

        logger.info(`Cleaned up ${result.count} expired sessions.`);
        return result.count;
    }
}

// Export function for convenience
export const cleanupSessions = async () => {
    const job = new SessionCleanupJob();
    return job.cleanupExpiredSessions();
};
