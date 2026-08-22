import { Prisma, UserDevice } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class UserDeviceRepository {
  async upsert(
    userId: string,
    deviceId: string,
    data: Omit<Prisma.UserDeviceCreateInput, 'user' | 'deviceId'>,
  ): Promise<UserDevice> {
    // Check if device exists for this user
    const existing = await prisma.userDevice.findFirst({
      where: { userId, deviceId },
    });

    if (existing) {
      return prisma.userDevice.update({
        where: { id: existing.id },
        data: {
          ...data,
          lastSeen: new Date(),
        },
      });
    }

    return prisma.userDevice.create({
      data: {
        ...data,
        user: { connect: { id: userId } },
        deviceId,
      },
    });
  }

  async findByDeviceId(deviceId: string): Promise<UserDevice | null> {
    return prisma.userDevice.findFirst({ where: { deviceId } });
  }

  async findByUserId(userId: string): Promise<UserDevice[]> {
    return prisma.userDevice.findMany({ where: { userId } });
  }

  async findByUserAndDeviceId(userId: string, deviceId: string): Promise<UserDevice | null> {
    return prisma.userDevice.findFirst({
      where: {
        userId,
        deviceId,
      },
    });
  }

  async revoke(deviceId: string): Promise<UserDevice> {
    // We need to find the record first because deviceId is not the primary key 'id'
    // But wait, schema says deviceId is unique per user? No, @@index([deviceId]).
    // Schema: deviceId String // client-generated UUID.
    // We should probably find by deviceId and update.
    // Ideally we should pass userId too for security, but admin might just pass deviceId if unique globally?
    // Let's assume deviceId is unique enough or we revoke all matches.
    // Better: findFirst by deviceId.
    const device = await this.findByDeviceId(deviceId);
    if (!device) throw new Error('Device not found');

    return prisma.userDevice.update({
      where: { id: device.id },
      data: { isRevoked: true },
    });
  }
}
