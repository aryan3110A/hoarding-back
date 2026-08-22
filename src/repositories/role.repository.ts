import { Role, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class RoleRepository {
    async findAll() {
        return prisma.role.findMany({
            include: { _count: { select: { users: true } } },
            orderBy: { name: 'asc' },
        });
    }

    async findById(id: number): Promise<Role | null> {
        return prisma.role.findUnique({ 
            where: { id },
            include: { _count: { select: { users: true } } },
        });
    }

    async findByName(name: string): Promise<Role | null> {
        return prisma.role.findUnique({ where: { name } });
    }

    async create(data: Prisma.RoleCreateInput): Promise<Role> {
        return prisma.role.create({ data });
    }

    async update(id: number, data: Prisma.RoleUpdateInput): Promise<Role> {
        return prisma.role.update({
            where: { id },
            data,
        });
    }

    async delete(id: number): Promise<Role> {
        return prisma.role.delete({ where: { id } });
    }
}
