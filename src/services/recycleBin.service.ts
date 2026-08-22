import { prisma } from '../lib/prisma';
import { NotFoundError, BadRequestError } from '../lib/errors';
import { HoardingService } from './hoarding.service';

const hoardingService = new HoardingService();

export class RecycleBinService {
  async list() {
    const rows = await prisma.deletedHoarding.findMany({
      orderBy: { deletedAt: 'desc' },
    });

    const now = new Date();
    return rows.map((row: any) => {
      const deletedAt = new Date(row.deletedAt);
      const ageInMs = now.getTime() - deletedAt.getTime();
      const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, 30 - ageInDays);

      return {
        id: row.id,
        hoardingId: row.hoardingId,
        code: row.code,
        city: row.city,
        area: row.area,
        landmark: row.landmark,
        deletedAt: row.deletedAt,
        deletedById: row.deletedById,
        originalStatus: row.originalStatus,
        daysRemaining,
      };
    });
  }

  async restore(hoardingId: string, actorId?: string) {
    const deletedRecord = await prisma.deletedHoarding.findUnique({
      where: { hoardingId },
    });

    if (!deletedRecord) {
      throw new NotFoundError('Hoarding not found in recycle bin');
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Update hoarding in database to restore status and unset isDeleted
      const restoredHoarding = await tx.hoarding.update({
        where: { id: hoardingId },
        data: {
          isDeleted: false,
          status: deletedRecord.originalStatus,
        },
      });

      // 2. Remove from DeletedHoarding
      await tx.deletedHoarding.delete({
        where: { hoardingId },
      });

      // 3. Create Audit Log
      await tx.auditLog.create({
        data: {
          userId: actorId || null,
          action: 'HOARDING_RESTORED',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            code: deletedRecord.code,
            restoredStatus: deletedRecord.originalStatus,
          } as any,
        },
      });

      return restoredHoarding;
    });

    return result;
  }

  async purge(hoardingId: string, actorId?: string) {
    // Call the permanent delete flow of hoardingService
    return hoardingService.delete(hoardingId, 'permanent', actorId);
  }

  // Cron/scheduled runner to clean up items older than 30 days
  async autoPurgeOldItems() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const oldItems = await prisma.deletedHoarding.findMany({
      where: {
        deletedAt: {
          lt: thirtyDaysAgo,
        },
      },
      select: {
        hoardingId: true,
        code: true,
      },
    });

    let purgedCount = 0;
    for (const item of oldItems) {
      try {
        await this.purge(item.hoardingId);
        purgedCount++;
        console.log(`Auto-purged soft-deleted hoarding ${item.code} (ID: ${item.hoardingId})`);
      } catch (err) {
        console.error(`Failed to auto-purge soft-deleted hoarding ${item.code}:`, err);
      }
    }

    return { purgedCount };
  }
}

export default new RecycleBinService();
