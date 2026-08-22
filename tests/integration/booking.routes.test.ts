import request from 'supertest';
import { createTestServer } from '../utils/testServer';
import { resetDatabase, seedTestData, cleanupTestData } from '../utils/prismaTestUtils';
import { prisma } from '../../src/lib/prisma';

let app: any;
let adminTokens: any;
let hoardingId: string;

beforeAll(async () => {
    app = await createTestServer();
    await resetDatabase();
    await seedTestData();

    // Login admin
    const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'admin@hoarding.local',
            password: 'Admin@123',
            deviceId: 'booking-admin-device',
        });
    adminTokens = adminLogin.body.data;

    // Create a hoarding
    const hoarding = await prisma.hoarding.create({
        data: {
            code: 'H-TEST-001',
            title: 'Test Hoarding',
            city: 'Mumbai',
            area: 'Test Area',
            status: 'available',
        },
    });
    hoardingId = hoarding.id;
});

afterAll(async () => {
    await cleanupTestData();
});

describe('Booking Routes (integration)', () => {
    describe('POST /api/bookings', () => {
        it('should create booking successfully', async () => {
            const bookingData = {
                hoardingId,
                clientName: 'Test Client',
                clientContact: '9876543210',
                startDate: new Date('2024-06-01'),
                endDate: new Date('2024-06-30'),
                price: 50000,
            };

            const res = await request(app)
                .post('/api/bookings')
                .set('Authorization', `Bearer ${adminTokens.accessToken}`)
                .send(bookingData)
                .expect(201);

            expect(res.body.success).toBe(true);
            expect(res.body.data.clientName).toBe(bookingData.clientName);

            // Verify in database
            const booking = await prisma.booking.findFirst({
                where: { hoardingId },
            });
            expect(booking).toBeTruthy();
            expect(booking?.clientName).toBe(bookingData.clientName);
            expect(booking?.createdBy).toBeTruthy();
        });

        it('should reject booking with overlapping dates', async () => {
            // Create first booking
            await prisma.booking.create({
                data: {
                    hoardingId,
                    clientName: 'First Client',
                    startDate: new Date('2024-07-01'),
                    endDate: new Date('2024-07-31'),
                    status: 'confirmed',
                    createdBy: (await prisma.user.findUnique({ where: { email: 'admin@hoarding.local' } }))?.id,
                },
            });

            // Try to create overlapping booking
            const overlappingBooking = {
                hoardingId,
                clientName: 'Second Client',
                startDate: new Date('2024-07-15'), // Overlaps
                endDate: new Date('2024-08-15'),
                price: 60000,
            };

            const res = await request(app)
                .post('/api/bookings')
                .set('Authorization', `Bearer ${adminTokens.accessToken}`)
                .send(overlappingBooking)
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('already booked');
        });

        it('should require authentication', async () => {
            await request(app)
                .post('/api/bookings')
                .send({
                    hoardingId,
                    clientName: 'Test',
                })
                .expect(401);
        });
    });
});
