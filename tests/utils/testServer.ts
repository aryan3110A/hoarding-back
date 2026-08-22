import app from '../../src/app';

let serverInstance: typeof app | null = null;

export async function createTestServer() {
    if (!serverInstance) {
        serverInstance = app;
    }
    return serverInstance;
}

export async function closeTestServer() {
    if (serverInstance) {
        // Express doesn't need explicit close for testing with supertest
        serverInstance = null;
    }
}

import { prisma } from '../../src/lib/prisma';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';
import bcrypt from 'bcrypt';

export async function createTestUser(email: string, roleName: string) {
    let role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) {
        try {
            role = await prisma.role.create({ data: { name: roleName } });
        } catch (e) {
            console.error('Role creation failed, attempting sequence reset:', e);
            // Reset sequence
            await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Role"', 'id'), coalesce(max(id)+1, 1), false) FROM "Role";`);
            try {
                role = await prisma.role.create({ data: { name: roleName } });
            } catch (e2) {
                console.error('Role creation failed again:', e2);
                role = await prisma.role.findFirst({ where: { name: roleName } });
            }
        }
    }

    if (!role) throw new Error(`Could not create or find role ${roleName}`);

    return prisma.user.create({
        data: {
            email,
            name: 'Test User',
            password: await bcrypt.hash('password', 10),
            roleId: role.id,
            isActive: true,
        },
        include: { role: true },
    });
}

import { redis } from '../../src/lib/redis';
import { v4 as uuidv4 } from 'uuid';

export async function generateTestToken(user: any) {
    const sessionId = uuidv4();
    // Store session in Redis
    await redis.set(`session:${sessionId}`, user.id, 'EX', 3600);

    return jwt.sign(
        { userId: user.id, role: user.role.name, email: user.email, sessionId },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
}
