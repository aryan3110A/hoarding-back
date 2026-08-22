import { RefreshSessionRepository } from '../../../src/repositories/refreshSession.repository';

jest.mock('../../../src/lib/prisma', () => ({
    prisma: {
        refreshSession: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

import { prisma } from '../../../src/lib/prisma';

describe('RefreshSessionRepository (unit)', () => {
    let refreshSessionRepository: RefreshSessionRepository;

    beforeEach(() => {
        jest.clearAllMocks();
        refreshSessionRepository = new RefreshSessionRepository();
    });

    describe('create', () => {
        it('should create a new refresh session', async () => {
            const sessionData = {
                userId: 'user-123',
                deviceId: 'device-456',
                refreshTokenHash: 'hashed-token',
                expiresAt: new Date('2024-12-31'),
            };

            const mockSession = {
                id: 'session-123',
                ...sessionData,
            };

            (prisma.refreshSession.create as jest.Mock).mockResolvedValue(mockSession);

            const result = await refreshSessionRepository.create(sessionData);

            expect(result).toEqual(mockSession);
            expect(prisma.refreshSession.create).toHaveBeenCalledWith({ data: sessionData });
        });
    });

    describe('findByTokenHash', () => {
        it('should find session by token hash with user and role', async () => {
            const mockSession = {
                id: 'session-123',
                userId: 'user-123',
                refreshTokenHash: 'hashed-token',
                user: {
                    id: 'user-123',
                    role: { id: 1, name: 'admin' },
                },
            };

            (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(mockSession);

            const result = await refreshSessionRepository.findByTokenHash('hashed-token');

            expect(result).toEqual(mockSession);
            expect(prisma.refreshSession.findFirst).toHaveBeenCalledWith({
                where: { refreshTokenHash: 'hashed-token' },
                include: { user: { include: { role: true } } },
            });
        });
    });

    describe('update', () => {
        it('should update session', async () => {
            const updateData = { lastUsedAt: new Date() };
            const mockUpdatedSession = {
                id: 'session-123',
                ...updateData,
            };

            (prisma.refreshSession.update as jest.Mock).mockResolvedValue(mockUpdatedSession);

            const result = await refreshSessionRepository.update('session-123', updateData);

            expect(result).toEqual(mockUpdatedSession);
            expect(prisma.refreshSession.update).toHaveBeenCalledWith({
                where: { id: 'session-123' },
                data: updateData,
            });
        });
    });

    describe('revoke', () => {
        it('should revoke session', async () => {
            const mockRevokedSession = {
                id: 'session-123',
                revoked: true,
            };

            (prisma.refreshSession.update as jest.Mock).mockResolvedValue(mockRevokedSession);

            const result = await refreshSessionRepository.revoke('session-123');

            expect(result).toEqual(mockRevokedSession);
            expect(prisma.refreshSession.update).toHaveBeenCalledWith({
                where: { id: 'session-123' },
                data: { revoked: true },
            });
        });
    });
});

