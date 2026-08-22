import { UserDeviceRepository } from '../../../src/repositories/userDevice.repository';

jest.mock('../../../src/lib/prisma', () => ({
    prisma: {
        userDevice: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
    },
}));

import { prisma } from '../../../src/lib/prisma';

describe('UserDeviceRepository (unit)', () => {
    let userDeviceRepository: UserDeviceRepository;

    beforeEach(() => {
        jest.clearAllMocks();
        userDeviceRepository = new UserDeviceRepository();
    });

    describe('upsert', () => {
        it('should update existing device', async () => {
            const userId = 'user-123';
            const deviceId = 'device-456';
            const existingDevice = {
                id: 'device-record-1',
                userId,
                deviceId,
            };

            const updateData = {
                deviceName: 'Updated Device',
                lastLat: 23.0343,
                lastLng: 72.5645,
            };

            (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(existingDevice);
            (prisma.userDevice.update as jest.Mock).mockResolvedValue({
                ...existingDevice,
                ...updateData,
                lastSeen: new Date(),
            });

            const result = await userDeviceRepository.upsert(userId, deviceId, updateData);

            expect(prisma.userDevice.findFirst).toHaveBeenCalledWith({
                where: { userId, deviceId },
            });
            expect(prisma.userDevice.update).toHaveBeenCalledWith({
                where: { id: existingDevice.id },
                data: {
                    ...updateData,
                    lastSeen: expect.any(Date),
                },
            });
        });

        it('should create new device if not exists', async () => {
            const userId = 'user-123';
            const deviceId = 'device-456';
            const createData = {
                deviceName: 'New Device',
                lastLat: 23.0343,
            };

            (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.userDevice.create as jest.Mock).mockResolvedValue({
                id: 'new-device-1',
                userId,
                deviceId,
                ...createData,
            });

            const result = await userDeviceRepository.upsert(userId, deviceId, createData);

            expect(prisma.userDevice.create).toHaveBeenCalledWith({
                data: {
                    ...createData,
                    user: { connect: { id: userId } },
                    deviceId,
                },
            });
        });
    });

    describe('findByDeviceId', () => {
        it('should find device by deviceId', async () => {
            const mockDevice = {
                id: 'device-record-1',
                userId: 'user-123',
                deviceId: 'device-456',
            };

            (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(mockDevice);

            const result = await userDeviceRepository.findByDeviceId('device-456');

            expect(result).toEqual(mockDevice);
            expect(prisma.userDevice.findFirst).toHaveBeenCalledWith({
                where: { deviceId: 'device-456' },
            });
        });
    });

    describe('findByUserId', () => {
        it('should find all devices for a user', async () => {
            const mockDevices = [
                { id: 'device-1', userId: 'user-123', deviceId: 'device-456' },
                { id: 'device-2', userId: 'user-123', deviceId: 'device-789' },
            ];

            (prisma.userDevice.findMany as jest.Mock).mockResolvedValue(mockDevices);

            const result = await userDeviceRepository.findByUserId('user-123');

            expect(result).toEqual(mockDevices);
            expect(prisma.userDevice.findMany).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
            });
        });
    });

    describe('revoke', () => {
        it('should revoke device', async () => {
            const mockDevice = {
                id: 'device-record-1',
                userId: 'user-123',
                deviceId: 'device-456',
            };

            (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(mockDevice);
            (prisma.userDevice.update as jest.Mock).mockResolvedValue({
                ...mockDevice,
                isRevoked: true,
            });

            const result = await userDeviceRepository.revoke('device-456');

            expect(result.isRevoked).toBe(true);
            expect(prisma.userDevice.update).toHaveBeenCalledWith({
                where: { id: mockDevice.id },
                data: { isRevoked: true },
            });
        });

        it('should throw error when device not found', async () => {
            (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(null);

            await expect(userDeviceRepository.revoke('non-existent')).rejects.toThrow('Device not found');
        });
    });
});

