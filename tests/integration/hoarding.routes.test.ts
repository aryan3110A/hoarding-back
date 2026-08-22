import request from 'supertest';
import { createTestServer } from '../utils/testServer';
import { resetDatabase, seedTestData, cleanupTestData } from '../utils/prismaTestUtils';
import { prisma } from '../../src/lib/prisma';
import bcrypt from 'bcrypt';

let app: any;
let adminTokens: any;
let salesTokens: any;
let territoryId: string;

beforeAll(async () => {
    app = await createTestServer();
    await resetDatabase();
    await seedTestData();

    // Create territory
    const territory = await prisma.territory.create({
        data: {
            name: 'Mumbai Central',
            city: 'Mumbai',
            description: 'Central Mumbai territory',
        },
    });
    territoryId = territory.id;

    // Create hoardings
    await prisma.hoarding.createMany({
        data: [
            { code: 'H-MUM-001', title: 'Marine Drive', city: 'Mumbai', area: 'South Mumbai', lat: 18.9432, lng: 72.8236, status: 'available' },
            { code: 'H-MUM-002', title: 'Bandra Junction', city: 'Mumbai', area: 'Bandra', lat: 19.0544, lng: 72.8414, status: 'available' },
            { code: 'H-DEL-001', title: 'Connaught Place', city: 'Delhi', area: 'Central Delhi', lat: 28.6304, lng: 77.2177, status: 'available' },
        ],
    });

    // Login admin
    const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'admin@hoarding.local',
            password: 'Admin@123',
            deviceId: 'admin-device',
        });
    adminTokens = adminLogin.body.data;

    // Create sales user
    const salesRole = await prisma.role.findUnique({ where: { name: 'sales' } });
    const salesUser = await prisma.user.create({
        data: {
            name: 'Sales User',
            email: 'sales@hoarding.local',
            password: await bcrypt.hash('Sales@123', 10),
            roleId: salesRole!.id,
            isActive: true,
        },
    });

    // Assign territory to sales user
    await prisma.userTerritory.create({
        data: {
            userId: salesUser.id,
            territoryId,
        },
    });

    // Login sales user
    const salesLogin = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'sales@hoarding.local',
            password: 'Sales@123',
            deviceId: 'sales-device',
        });
    salesTokens = salesLogin.body.data;
});

afterAll(async () => {
    await cleanupTestData();
});

describe('Hoarding Routes - RBAC (integration)', () => {
    describe('GET /api/hoardings', () => {
        it('should return all hoardings for admin', async () => {
            const res = await request(app)
                .get('/api/hoardings')
                .set('Authorization', `Bearer ${adminTokens.accessToken}`)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.hoardings).toBeInstanceOf(Array);
            expect(res.body.data.hoardings.length).toBe(3);
        });

        it('should return only territory hoardings for sales user', async () => {
            const res = await request(app)
                .get('/api/hoardings')
                .set('Authorization', `Bearer ${salesTokens.accessToken}`)
                .expect(200);

            expect(res.body.success).toBe(true);
            const hoardings = res.body.data.hoardings;

            // Sales user should only see Mumbai hoardings
            expect(hoardings.every((h: any) => h.city === 'Mumbai')).toBe(true);
            expect(hoardings.some((h: any) => h.city === 'Delhi')).toBe(false);
        });

        it('should filter hoardings by city', async () => {
            const res = await request(app)
                .get('/api/hoardings?city=Delhi')
                .set('Authorization', `Bearer ${adminTokens.accessToken}`)
                .expect(200);

            const hoardings = res.body.data.hoardings;
            expect(hoardings.every((h: any) => h.city === 'Delhi')).toBe(true);
        });
    });

    describe('POST /api/hoardings', () => {
        it('should allow admin to create hoarding', async () => {
            const newHoarding = {
                code: 'H-MUM-003',
                title: 'Andheri Station',
                city: 'Mumbai',
                area: 'Andheri',
                lat: 19.1136,
                lng: 72.8697,
                status: 'available',
            };

            const res = await request(app)
                .post('/api/hoardings')
                .set('Authorization', `Bearer ${adminTokens.accessToken}`)
                .send(newHoarding)
                .expect(201);

            expect(res.body.data.code).toBe(newHoarding.code);
        });

        it('should deny sales user from creating hoarding', async () => {
            const newHoarding = {
                code: 'H-MUM-004',
                title: 'Borivali',
                city: 'Mumbai',
                area: 'Borivali West',
                status: 'available',
            };

            await request(app)
                .post('/api/hoardings')
                .set('Authorization', `Bearer ${salesTokens.accessToken}`)
                .send(newHoarding)
                .expect(403);
        });
    });

    describe('GET /api/hoardings/:id/availability', () => {
        it('should return availability calendar for a hoarding', async () => {
            const hoarding = await prisma.hoarding.findFirst();

            const res = await request(app)
                .get(`/api/hoardings/${hoarding?.id}/availability`)
                .set('Authorization', `Bearer ${adminTokens.accessToken}`)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeInstanceOf(Array);
        });
    });
});
