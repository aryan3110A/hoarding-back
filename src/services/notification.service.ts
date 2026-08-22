import { NotificationRepository } from '../repositories/notification.repository';
import { Prisma } from '@prisma/client';
import { eventBus } from '../lib/eventBus';

const notificationRepository = new NotificationRepository();

export class NotificationService {
  async createNotification(
    userId: string,
    title: string,
    body: string,
    link?: string,
    dedupeKey?: string,
  ) {
    const created = dedupeKey
      ? await notificationRepository.upsertByDedupeKey({
          dedupeKey,
          create: {
            user: { connect: { id: userId } },
            title,
            body,
            link,
            dedupeKey,
          } as unknown as Prisma.NotificationCreateInput,
        })
      : await notificationRepository.create({
          user: { connect: { id: userId } },
          title,
          body,
          link,
        });
    try {
      eventBus.emit('notification', { userId, notification: created });
    } catch (_) {}
    return created;
  }

  async notifyUsers(userIds: string[], title: string, body: string, link?: string) {
    if (!userIds || userIds.length === 0) {
      return;
    }

    await Promise.all(
      userIds.map(async (userId) => {
        const created = await notificationRepository.create({
          user: { connect: { id: userId } },
          title,
          body,
          link,
        });
        try {
          eventBus.emit('notification', { userId, notification: created });
        } catch (_) {}
      }),
    );
  }

  async notifyUsersIdempotent(
    userIds: string[],
    title: string,
    body: string,
    link: string | undefined,
    dedupeKeyBase: string,
  ) {
    if (!userIds || userIds.length === 0) return;
    await Promise.all(
      userIds.map(async (userId) => {
        const dedupeKey = `${dedupeKeyBase}:${userId}`;
        await this.createNotification(userId, title, body, link, dedupeKey);
      }),
    );
  }

  async getUserNotifications(userId: string, params: { page?: string; limit?: string }) {
    const page = parseInt(params.page || '1');
    const limit = parseInt(params.limit || '10');
    const skip = (page - 1) * limit;
    const take = limit;

    return notificationRepository.findByUserId(userId, { skip, take });
  }

  async markAsRead(id: string) {
    return notificationRepository.markAsRead(id);
  }

  async getUnreadCount(userId: string) {
    return notificationRepository.countUnread(userId);
  }
}
