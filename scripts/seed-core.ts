import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';

async function seedCore() {
  console.log('Seeding roles and admin user...');

  const roles = ['ADMIN', 'OWNER', 'MANAGER', 'SALES', 'DESIGNER', 'FITTER'];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role },
    });
  }

  const adminPassword = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'System Admin',
      email: 'admin@example.com',
      phone: '9999999999',
      password: adminPassword,
      role: {
        connect: { name: 'ADMIN' },
      },
      isActive: true,
    },
  });

  console.log('Core seed completed');
}

seedCore()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
