import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestUser, generateTestToken } from '../utils/testServer';

describe('Rent Routes Integration', () => {
    let ownerToken: string;
    let salesToken: string;
    let hoardingId: string;

    beforeAll(async () => {
        // Create users
        const owner = await createTestUser('rent_owner@test.com', 'owner');
        ownerToken = await generateTestToken(owner);

        const sales = await createTestUser('rent_sales@test.com', 'sales');
        salesToken = await generateTestToken(sales);

        // Create a hoarding
        const hoarding = await prisma.hoarding.create({
            data: {
                code: 'RENT_TEST_001',
                title: 'Rent Test Hoarding',
                status: 'available',
                lat: 0,
                lng: 0,
            },
        });
        hoardingId = hoarding.id;
    });

    afterAll(async () => {
        // Delete in reverse order of dependency
        await prisma.booking.deleteMany();
        await prisma.rent.deleteMany();
        await prisma.hoarding.deleteMany();
        await prisma.locationLog.deleteMany();
        await prisma.notification.deleteMany();
        await prisma.userDevice.deleteMany();
        await prisma.refreshSession.deleteMany();
        await prisma.userTerritory.deleteMany();
        await prisma.user.deleteMany();
    });

    describe('POST /api/hoardings/:id/rent', () => {
        it('should allow Owner to save rent details', async () => {
            const res = await request(app)
                .post(`/api/hoardings/${hoardingId}/rent`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({
                    partyType: 'Private',
                    rentAmount: 5000,
                    paymentMode: 'Monthly',
                    lastPaymentDate: '2023-01-01',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.rentAmount).toBe('5000');
            expect(res.body.data.nextDueDate).toBeDefined();
        });

        it('should deny Sales user from saving rent details', async () => {
            const res = await request(app)
                .post(`/api/hoardings/${hoardingId}/rent`)
                .set('Authorization', `Bearer ${salesToken}`)
                .send({
                    partyType: 'Private',
                    rentAmount: 5000,
                    paymentMode: 'Monthly',
                });

            expect(res.status).toBe(403);
        });
    });

    describe('GET /api/hoardings/:id/rent', () => {
        it('should allow authenticated user to view rent details', async () => {
            const res = await request(app)
                .get(`/api/hoardings/${hoardingId}/rent`)
                .set('Authorization', `Bearer ${salesToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.rentAmount).toBe('5000');
        });
    });

    describe('POST /api/hoardings/:id/rent/recalculate', () => {
        it('should allow Owner to recalculate rent', async () => {
            const res = await request(app)
                .post(`/api/hoardings/${hoardingId}/rent/recalculate`)
                .set('Authorization', `Bearer ${ownerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // 5000 + 10% = 5500
            expect(Number(res.body.data.rentAmount)).toBe(5500);
        });
    });
});
