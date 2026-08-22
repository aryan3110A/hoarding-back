import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('✅ Running SAFE seed (non-destructive)...');

  /**
   * 1. Ensure Roles exist
   */
  const roles = [
    'owner',
    'admin',
    'manager',
    'sales',
    'sales_head',
    'designer',
    'supervisor',
    'fitter',
    'accountant',
  ];
  const roleMap: Record<string, number> = {};

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    roleMap[roleName] = role.id;
    console.log(`✅ Role ensured: ${roleName}`);
  }

  /**
   * 2. Ensure Users exist (NO overwrite)
   */
  const passwordHash = await bcrypt.hash('Password@123', 10);

  const users = [
    { name: 'Owner User', email: 'owner@demo.com', role: 'owner' },
    { name: 'Admin User', email: 'admin@demo.com', role: 'admin' },
    { name: 'Manager User', email: 'manager@demo.com', role: 'manager' },
    { name: 'Sales User', email: 'sales@demo.com', role: 'sales' },
    { name: 'Sales Head User', email: 'saleshead@demo.com', role: 'sales_head' },
    { name: 'Designer User', email: 'designer@demo.com', role: 'designer' },
    { name: 'Supervisor User', email: 'supervisor@demo.com', role: 'supervisor' },
    { name: 'Fitter User', email: 'fitter@demo.com', role: 'fitter' },
    { name: 'Accountant User', email: 'accountant@demo.com', role: 'accountant' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {}, // ⛔ DO NOT modify existing users
      create: {
        name: u.name,
        email: u.email,
        password: passwordHash,
        roleId: roleMap[u.role],
        isActive: true,
      },
    });
    console.log(`✅ User ensured: ${u.email}`);
  }

  console.log('✅ Safe seeding completed — NO data was deleted.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
