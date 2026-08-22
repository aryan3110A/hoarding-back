import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';

describe('Auth API', () => {
    beforeAll(async () => {
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma.$disconnect();
        await redis.quit();
    });

    it('should return 401 for invalid credentials', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'wrong@email.com',
                password: 'wrongpassword',
                deviceId: 'test-device',
            });
        expect(res.status).toBe(401);
    });

    // Add more tests as needed
});
