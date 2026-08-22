import request from 'supertest';
import { createTestServer } from '../utils/testServer';
import { resetDatabase, seedTestData, cleanupTestData } from '../utils/prismaTestUtils';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';

let app: any;

beforeAll(async () => {
  app = await createTestServer();
  await resetDatabase();
  await seedTestData();
});

afterAll(async () => {
  await cleanupTestData();
});

describe('Auth Routes (integration)', () => {
  describe('POST /api/auth/login', () => {
    it('should successfully login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@hoarding.local',
          password: 'Admin@123',
          deviceId: 'test-device-1',
          deviceName: 'Test Device',
          lat: 23.0343,
          lng: 72.5645,
        })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user.email).toBe('admin@hoarding.local');

      // Verify refresh session was created in DB
      const session = await prisma.refreshSession.findFirst({
        where: { userId: res.body.data.user.id },
      });
      expect(session).toBeTruthy();
    });

    it('should reject login with invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@hoarding.local',
          password: 'WrongPassword',
          deviceId: 'test-device-2',
        })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should reject login for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'Password123',
          deviceId: 'test-device-3',
        })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should create user device record on successful login', async () => {
      const deviceId = 'test-device-login-1';

      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@hoarding.local',
          password: 'Admin@123',
          deviceId,
          deviceName: 'Integration Test Device',
        })
        .expect(200);

      const device = await prisma.userDevice.findFirst({
        where: { deviceId },
      });

      expect(device).toBeTruthy();
      expect(device?.deviceName).toBe('Integration Test Device');
    });

    it('should allow only one active sales login at a time', async () => {
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('Sales@123', 10);

      await prisma.user.upsert({
        where: { email: 'sales@hoarding.local' },
        update: {},
        create: {
          name: 'Sales User',
          email: 'sales@hoarding.local',
          password: hashedPassword,
          roleId: 2,
          isActive: true,
        },
      });

      const firstLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sales@hoarding.local',
          password: 'Sales@123',
          deviceId: 'sales-device-1',
        })
        .expect(200);

      const secondLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sales@hoarding.local',
          password: 'Sales@123',
          deviceId: 'sales-device-2',
        })
        .expect(200);

      await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${firstLogin.body.data.accessToken}`)
        .expect(401);

      await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${secondLogin.body.data.accessToken}`)
        .expect(200);
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshToken: string;
    let accessToken: string;

    beforeEach(async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'admin@hoarding.local',
        password: 'Admin@123',
        deviceId: 'refresh-test-device',
      });

      refreshToken = loginRes.body.data.refreshToken;
    });

    it('should generate new access token with valid refresh token', async () => {
      const res = await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
    });

    it('should reject invalid refresh token', async () => {
      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token-12345' })
        .expect(401);
    });

    it('should update lastUsedAt timestamp on refresh', async () => {
      const sessionBefore = await prisma.refreshSession.findFirst({
        orderBy: { issuedAt: 'desc' },
      });

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(200);

      const sessionAfter = await prisma.refreshSession.findFirst({
        where: { id: sessionBefore?.id },
      });

      expect(sessionAfter?.lastUsedAt.getTime()).toBeGreaterThan(
        sessionBefore?.lastUsedAt.getTime() || 0,
      );
    });

    it('should verify Redis session key exists after refresh', async () => {
      const session = await prisma.refreshSession.findFirst({
        orderBy: { issuedAt: 'desc' },
      });

      const redisKey = `session:${session?.id}`;
      const exists = await redis.exists(redisKey);

      expect(exists).toBe(1); // Redis key should exist
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke refresh session on logout', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'admin@hoarding.local',
        password: 'Admin@123',
        deviceId: 'logout-test-device',
      });

      const { refreshToken, accessToken } = loginRes.body.data;

      const session = await prisma.refreshSession.findFirst({
        orderBy: { issuedAt: 'desc' },
      });

      await request(app).post('/api/auth/logout').send({ refreshToken }).expect(200);

      // Verify session is revoked in DB
      const revokedSession = await prisma.refreshSession.findUnique({
        where: { id: session?.id },
      });
      expect(revokedSession?.revoked).toBe(true);

      // Verify Redis key is deleted
      const redisKey = `session:${session?.id}`;
      const exists = await redis.exists(redisKey);
      expect(exists).toBe(0);

      // Try to use the refresh token again - should fail
      await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(401);
    });
  });

  describe('GET /api/auth/session', () => {
    it('should return the current authenticated session details', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@hoarding.local',
          password: 'Admin@123',
          deviceId: 'session-test-device',
        })
        .expect(200);

      const res = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('deviceId', 'session-test-device');
      expect(res.body.data).toHaveProperty('deviceName');
      expect(res.body.data).toHaveProperty('platform');
    });
  });

  describe('Session timeout and Redis', () => {
    it('should create Redis session key on login with correct TTL', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@hoarding.local',
          password: 'Admin@123',
          deviceId: 'redis-test-device',
        })
        .expect(200);

      const session = await prisma.refreshSession.findFirst({
        orderBy: { issuedAt: 'desc' },
      });

      const redisKey = `session:${session?.id}`;
      const exists = await redis.exists(redisKey);
      expect(exists).toBe(1);

      // Verify TTL is set (should be around 60 minutes for admin)
      const ttl = await redis.ttl(redisKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60 * 60); // 60 minutes max
    });
  });
});
