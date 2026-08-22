import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';

function assertTestDatabase() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `Refusing to reset database when NODE_ENV is not 'test' (got: ${process.env.NODE_ENV})`,
    );
  }

  const url = process.env.DATABASE_URL || '';
  // Heuristic: require an explicit test DB name or the documented local test port.
  const looksLikeTestDb =
    url.includes('hoarding_test') ||
    url.includes('localhost:5433') ||
    url.includes('127.0.0.1:5433');
  if (!looksLikeTestDb) {
    throw new Error(
      `Refusing to TRUNCATE tables because DATABASE_URL does not look like a test database. DATABASE_URL=${url}`,
    );
  }
}

export async function resetDatabase() {
  assertTestDatabase();
  // Truncate tables in correct order (respecting foreign keys)
  const tables = [
    'AuditLog',
    'Booking',
    'LocationLog',
    'RefreshSession',
    'UserDevice',
    'UserTerritory',
    'Hoarding',
    'Territory',
    'User',
    'Role',
  ];

  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
}

export async function seedTestData() {
  // Create roles
  await prisma.role.createMany({
    data: [
      { id: 1, name: 'admin' },
      { id: 2, name: 'sales' },
      { id: 3, name: 'accounts' },
      { id: 4, name: 'ops' },
    ],
    skipDuplicates: true,
  });

  // Create admin user (password: Admin@123)
  const bcrypt = require('bcrypt');
  const hashedPassword = await bcrypt.hash('Admin@123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@hoarding.local' },
    update: {},
    create: {
      name: 'System Admin',
      email: 'admin@hoarding.local',
      password: hashedPassword,
      roleId: 1,
      isActive: true,
    },
  });
}

export async function cleanupTestData() {
  await prisma.$disconnect();
  const r = redis as unknown as {
    quit?: () => Promise<unknown> | unknown;
    disconnect?: () => Promise<unknown> | unknown;
  };
  if (typeof r.quit === 'function') {
    await r.quit();
    return;
  }
  if (typeof r.disconnect === 'function') {
    await r.disconnect();
  }
}
