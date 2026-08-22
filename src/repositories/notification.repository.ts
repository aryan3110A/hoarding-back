import { prisma } from '../lib/prisma';
import { Prisma, Notification } from '@prisma/client';

export class NotificationRepository {
  async create(data: Prisma.NotificationCreateInput): Promise<Notification> {
    return prisma.notification.create({ data });
  }

  async upsertByDedupeKey(args: {
    dedupeKey: string;
    create: Prisma.NotificationCreateInput;
    update?: Prisma.NotificationUpdateInput;
  }): Promise<Notification> {
    return prisma.notification.upsert({
      where: { dedupeKey: args.dedupeKey },
      create: args.create,
      update: args.update || {},
    });
  }

  async findByUserId(
    userId: string,
    params: { skip?: number; take?: number } = {},
  ): Promise<{ notifications: Notification[]; total: number }> {
    const { skip, take } = params;
    const [notifications, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId } }),
    ]);
    return { notifications, total };
  }

  async markAsRead(id: string): Promise<Notification> {
    return prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  async markAllAsReadByUser(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return Number(result.count || 0);
  }

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, read: false },
    });
  }
}
