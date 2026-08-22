import { AuthService } from '../../../src/services/auth.service';
import { Security } from '../../../src/lib/security';
import bcrypt from 'bcryptjs';

import { LocationRepository } from '../../../src/repositories/location.repository';

// Mock dependencies
jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    userDevice: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      revoke: jest.fn(),
    },
  },
}));

jest.mock('../../../src/lib/redis', () => {
  const redis = {
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
  };
  return {
    redis,
    getRedis: () => redis,
  };
});

jest.mock('../../../src/repositories/location.repository');

import { prisma } from '../../../src/lib/prisma';
import { redis } from '../../../src/lib/redis';

describe('AuthService (unit)', () => {
  let authService: AuthService;
  let mockHashedPassword: string;

  beforeAll(async () => {
    // Generate a real bcrypt hash for 'Admin@123'
    mockHashedPassword = await bcrypt.hash('Admin@123', 10);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService();
  });

  describe('login', () => {
    const validLoginData = {
      email: 'admin@hoarding.local',
      password: 'Admin@123',
      deviceId: 'test-device-1',
      deviceName: 'Test Device',
      lat: 23.0343,
      lng: 72.5645,
      ip: '127.0.0.1',
    };

    let mockUser: any;

    beforeEach(() => {
      mockUser = {
        id: 'user-123',
        email: 'admin@hoarding.local',
        password: mockHashedPassword,
        roleId: 1,
        name: 'System Admin',
        isActive: true,
        role: { id: 1, name: 'admin' },
      };
    });

    it('should successfully login with valid credentials', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.userDevice.create as jest.Mock).mockResolvedValue({
        id: 'device-1',
        userId: mockUser.id,
        deviceId: validLoginData.deviceId,
      });
      (prisma.refreshSession.create as jest.Mock).mockResolvedValue({
        id: 'session-123',
        userId: mockUser.id,
        refreshTokenHash: 'hashed-token',
      });
      (redis.setex as jest.Mock).mockResolvedValue('OK');

      const result = await authService.login(validLoginData);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(validLoginData.email);
      expect(prisma.refreshSession.create).toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalled();
    });

    it('should reject login with invalid password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        authService.login({
          ...validLoginData,
          password: 'WrongPassword123',
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should reject login for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(authService.login(validLoginData)).rejects.toThrow('Invalid credentials');
    });

    it('should reject login for inactive user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(authService.login(validLoginData)).rejects.toThrow();
    });

    it('should revoke previous sales sessions before creating a new sales login session', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        role: { id: 2, name: 'sales' },
      });
      (prisma.refreshSession.findMany as jest.Mock).mockResolvedValue([
        { id: 'old-session-1' },
        { id: 'old-session-2' },
      ]);
      (prisma.refreshSession.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.userDevice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.userDevice.create as jest.Mock).mockResolvedValue({
        id: 'device-1',
        userId: mockUser.id,
        deviceId: validLoginData.deviceId,
      });
      (prisma.refreshSession.create as jest.Mock).mockResolvedValue({
        id: 'session-123',
        userId: mockUser.id,
        refreshTokenHash: 'hashed-token',
      });
      (redis.del as jest.Mock).mockResolvedValue(1);
      (redis.setex as jest.Mock).mockResolvedValue('OK');

      await authService.login(validLoginData);

      expect(prisma.refreshSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: mockUser.id, revoked: false }),
        }),
      );
      expect(prisma.refreshSession.updateMany).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith('session:old-session-1');
      expect(redis.del).toHaveBeenCalledWith('session:old-session-2');
    });
  });

  describe('refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockSession = {
        id: 'session-123',
        userId: 'user-123',
        refreshTokenHash: 'hashed-token',
        revoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        user: { id: 'user-123', role: { name: 'admin' } },
      };

      (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(mockSession);
      (prisma.refreshSession.update as jest.Mock).mockResolvedValue({
        ...mockSession,
        lastUsedAt: new Date(),
      });
      (redis.exists as jest.Mock).mockResolvedValue(1);
      (redis.expire as jest.Mock).mockResolvedValue(1);

      const result = await authService.refresh('valid-refresh-token');

      expect(result).toHaveProperty('accessToken');
      expect(prisma.refreshSession.update).toHaveBeenCalled();
      expect(redis.expire).toHaveBeenCalled();
    });

    it('should reject expired refresh token', async () => {
      const mockSession = {
        id: 'session-123',
        userId: 'user-123',
        refreshTokenHash: 'hashed-token',
        revoked: false,
        expiresAt: new Date(Date.now() - 1000), // Expired
        user: { id: 'user-123', role: { name: 'admin' } },
      };

      (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(mockSession);

      await expect(authService.refresh('expired-token')).rejects.toThrow('Refresh token expired');
    });

    it('should reject revoked refresh token', async () => {
      const mockSession = {
        id: 'session-123',
        userId: 'user-123',
        refreshTokenHash: 'hashed-token',
        revoked: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: { id: 'user-123', role: { name: 'admin' } },
      };

      (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(mockSession);

      await expect(authService.refresh('revoked-token')).rejects.toThrow('Invalid refresh token');
    });

    it('should reject when Redis session expired (inactivity)', async () => {
      const mockSession = {
        id: 'session-123',
        userId: 'user-123',
        refreshTokenHash: 'hashed-token',
        revoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: { id: 'user-123', role: { name: 'admin' } },
      };

      (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(mockSession);
      (redis.exists as jest.Mock).mockResolvedValue(0); // Session expired in Redis

      await expect(authService.refresh('inactive-token')).rejects.toThrow(
        'Session expired due to inactivity',
      );
    });
  });

  describe('logout', () => {
    it('should revoke session and delete Redis key', async () => {
      const mockSession = {
        id: 'session-123',
        userId: 'user-123',
        refreshTokenHash: 'hashed-token',
      };

      (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(mockSession);
      (prisma.refreshSession.update as jest.Mock).mockResolvedValue({
        ...mockSession,
        revoked: true,
      });
      (redis.del as jest.Mock).mockResolvedValue(1);

      await authService.logout('valid-refresh-token');

      expect(prisma.refreshSession.update).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith('session:session-123');
    });

    it('should handle logout when session not found gracefully', async () => {
      (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(null);

      await authService.logout('invalid-token');

      expect(prisma.refreshSession.update).not.toHaveBeenCalled();
    });
  });

  describe('token generation', () => {
    it('should generate access token with correct payload', async () => {
      const userId = 'user-123';
      const token = Security.generateAccessToken({
        userId,
        role: 'admin',
        sessionId: 'session-123',
      });

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      const decoded = Security.verifyAccessToken(token) as any;
      expect(decoded.userId).toBe(userId);
      expect(decoded.role).toBe('admin');
    });
  });
});
