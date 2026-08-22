import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class RefreshSessionRepository {
  async create(data: Prisma.RefreshSessionUncheckedCreateInput) {
    return prisma.refreshSession.create({
      data,
    });
  }

  async findByTokenHash(refreshTokenHash: string) {
    return prisma.refreshSession.findFirst({
      where: { refreshTokenHash },
      include: { user: { include: { role: true } } },
    });
  }

  async findById(id: string) {
    return prisma.refreshSession.findUnique({
      where: { id },
      include: { user: { include: { role: true } } },
    });
  }

  async update(id: string, data: Prisma.RefreshSessionUpdateInput) {
    return prisma.refreshSession.update({
      where: { id },
      data,
    });
  }

  async revoke(id: string) {
    return prisma.refreshSession.update({
      where: { id },
      data: { revoked: true },
    });
  }

  async revokeActiveByUserId(userId: string) {
    const activeSessions = await prisma.refreshSession.findMany({
      where: {
        userId,
        revoked: false,
      },
      select: {
        id: true,
      },
    });

    if (activeSessions.length === 0) {
      return [] as Array<{ id: string }>;
    }

    await prisma.refreshSession.updateMany({
      where: {
        userId,
        revoked: false,
      },
      data: {
        revoked: true,
      },
    });

    return activeSessions;
  }

  async revokeActiveByUserIdAndDeviceId(userId: string, deviceId: string) {
    const activeSessions = await prisma.refreshSession.findMany({
      where: {
        userId,
        deviceId,
        revoked: false,
      },
      select: {
        id: true,
      },
    });

    if (activeSessions.length === 0) {
      return [] as Array<{ id: string }>;
    }

    await prisma.refreshSession.updateMany({
      where: {
        userId,
        deviceId,
        revoked: false,
      },
      data: {
        revoked: true,
      },
    });

    return activeSessions;
  }

  async findActiveByUserId(userId: string) {
    return prisma.refreshSession.findMany({
      where: {
        userId,
        revoked: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: [{ lastUsedAt: 'desc' }, { issuedAt: 'desc' }],
      select: {
        id: true,
        deviceId: true,
        issuedAt: true,
        lastUsedAt: true,
      },
    });
  }

  async revokeMany(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    await prisma.refreshSession.updateMany({
      where: {
        id: {
          in: ids,
        },
      },
      data: {
        revoked: true,
      },
    });
  }

  async delete(id: string) {
    return prisma.refreshSession.delete({
      where: { id },
    });
  }
}
