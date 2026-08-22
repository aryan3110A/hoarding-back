import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class UserRepository {
    async create(data: Prisma.UserCreateInput) {
        return prisma.user.create({ data });
    }

    async findAll() {
        return prisma.user.findMany({
            include: { role: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findByEmail(email: string) {
        return prisma.user.findUnique({
            where: { email },
            include: { role: true },
        });
    }

    async findByRole(roleName: string) {
        return prisma.user.findMany({
            where: { role: { name: roleName } },
            include: { role: true },
        });
    }

    async findByRoles(roleNames: string[]) {
        if (!roleNames || roleNames.length === 0) {
            return [];
        }

        return prisma.user.findMany({
            where: {
                isActive: true,
                role: {
                    name: { in: roleNames },
                },
            },
            include: { role: true },
        });
    }

    async findByPhone(phone: string) {
        return prisma.user.findUnique({
            where: { phone },
            include: { role: true },
        });
    }

    async findByName(name: string) {
        return prisma.user.findMany({
            where: {
                name: { equals: name, mode: 'insensitive' },
            },
            include: { role: true },
        });
    }

    async findById(id: string) {
        return prisma.user.findUnique({
            where: { id },
            include: { role: true },
        });
    }

    async update(id: string, data: Prisma.UserUpdateInput) {
        return prisma.user.update({
            where: { id },
            data,
            include: { role: true },
        });
    }

    async delete(id: string) {
        return prisma.user.delete({
            where: { id },
        });
    }
}
