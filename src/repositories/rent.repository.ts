import { prisma } from '../lib/prisma';
import { Prisma, Rent } from '@prisma/client';

export class RentRepository {
    async create(data: Prisma.RentCreateInput): Promise<Rent> {
        return prisma.rent.create({ data });
    }

    async update(id: string, data: Prisma.RentUpdateInput): Promise<Rent> {
        return prisma.rent.update({
            where: { id },
            data,
        });
    }

    async findByHoardingId(hoardingId: string): Promise<Rent | null> {
        return prisma.rent.findUnique({
            where: { hoardingId },
        });
    }

    async findUpcomingDues(days: number) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + days);

        return prisma.rent.findMany({
            where: {
                nextDueDate: {
                    lte: targetDate,
                    gte: new Date(), // Optional: don't fetch past dues? Or maybe we should.
                },
            },
            include: {
                hoarding: true,
            },
            orderBy: {
                nextDueDate: 'asc',
            },
        });
    }

    async findAll(params: { skip?: number; take?: number } = {}): Promise<{ rents: Rent[]; total: number }> {
        const { skip, take } = params;
        const [rents, total] = await prisma.$transaction([
            prisma.rent.findMany({
                skip,
                take,
                include: { hoarding: true },
                orderBy: { nextDueDate: 'asc' },
            }),
            prisma.rent.count(),
        ]);
        return { rents, total };
    }

    async findDueForIncrement(year: number): Promise<Rent[]> {
        return prisma.rent.findMany({
            where: {
                incrementYear: {
                    lte: year,
                },
            },
        });
    }
}
