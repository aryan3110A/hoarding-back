import request from 'supertest';
import { createTestServer } from '../utils/testServer';
import { resetDatabase, seedTestData, cleanupTestData } from '../utils/prismaTestUtils';
import { prisma } from '../../src/lib/prisma';

let app: any;
let authTokens: any;

beforeAll(async () => {
  app = await createTestServer();
  await resetDatabase();
  await seedTestData();

  // Login to get auth tokens
  const loginRes = await request(app).post('/api/auth/login').send({
    email: 'admin@hoarding.local',
    password: 'Admin@123',
    deviceId: 'device-test-1',
  });

  authTokens = loginRes.body.data;
});

afterAll(async () => {
  await cleanupTestData();
});

describe('Device Routes (integration)', () => {
  describe('POST /api/devices/:deviceId/ping', () => {
    const deviceId = 'ping-test-device';

    beforeEach(async () => {
      // Create a user device first for ping to work
      const user = await prisma.user.findUnique({ where: { email: 'admin@hoarding.local' } });
      if (user) {
        // Check if device already exists
        const existing = await prisma.userDevice.findFirst({
          where: { userId: user.id, deviceId },
        });
        if (!existing) {
          await prisma.userDevice.create({
            data: {
              userId: user.id,
              deviceId,
              lastSeen: new Date(),
            },
          });
        }
      }
    });

    it('should update device lastSeen and log location for the authenticated device owner', async () => {
      await request(app)
        .post(`/api/devices/${deviceId}/ping`)
        .set('Authorization', `Bearer ${authTokens.accessToken}`)
        .send({
          lat: 23.0343,
          lng: 72.5645,
          accuracy: 10,
          ip: '127.0.0.1',
        })
        .expect(200);

      // Verify device was updated
      const device = await prisma.userDevice.findFirst({
        where: { deviceId },
      });

      expect(device).toBeTruthy();
      expect(device?.lastLat).toBeCloseTo(23.0343, 4);
      expect(device?.lastLng).toBeCloseTo(72.5645, 4);
    });

    it('should require authentication', async () => {
      await request(app)
        .post(`/api/devices/${deviceId}/ping`)
        .send({
          lat: 23.0343,
          lng: 72.5645,
        })
        .expect(401);
    });
  });

  describe('POST /api/devices/:deviceId/checkin', () => {
    const deviceId = 'checkin-test-device';

    it('should create location log entry', async () => {
      const checkinData = {
        lat: 23.045,
        lng: 72.57,
        accuracy: 5,
        note: 'Visited client site',
      };

      await request(app)
        .post(`/api/devices/${deviceId}/checkin`)
        .set('Authorization', `Bearer ${authTokens.accessToken}`)
        .send(checkinData)
        .expect(200);

      // Verify location log was created
      const locationLog = await prisma.locationLog.findFirst({
        where: {
          deviceId,
          type: 'checkin',
        },
      });

      expect(locationLog).toBeTruthy();
      expect(locationLog?.lat).toBeCloseTo(checkinData.lat, 4);
      expect(locationLog?.lng).toBeCloseTo(checkinData.lng, 4);
      expect(locationLog?.note).toBe(checkinData.note);
    });
  });
});
