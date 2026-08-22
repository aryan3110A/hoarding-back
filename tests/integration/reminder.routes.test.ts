import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestUser, generateTestToken } from '../utils/testServer';

describe('Reminder Routes Integration', () => {
    let ownerToken: string;
    let salesToken: string;

    beforeAll(async () => {
        const owner = await createTestUser('reminder_owner@test.com', 'owner');
        ownerToken = await generateTestToken(owner);

        const sales = await createTestUser('reminder_sales@test.com', 'sales');
        salesToken = await generateTestToken(sales);
    });

    afterAll(async () => {
        await prisma.locationLog.deleteMany();
        await prisma.notification.deleteMany();
        await prisma.rent.deleteMany();
        await prisma.userDevice.deleteMany();
        await prisma.refreshSession.deleteMany();
        await prisma.user.deleteMany();
    });

    describe('POST /api/reminders/send', () => {
        it('should allow Owner to trigger reminders', async () => {
            const res = await request(app)
                .post('/api/reminders/send')
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({ days: 7 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should deny Sales user from triggering reminders', async () => {
            const res = await request(app)
                .post('/api/reminders/send')
                .set('Authorization', `Bearer ${salesToken}`)
                .send({ days: 7 });

            expect(res.status).toBe(403);
        });
    });
});
