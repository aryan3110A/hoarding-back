import { Prisma, Booking } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class BookingRepository {
    async create(data: Prisma.BookingCreateInput): Promise<Booking> {
        // Create a completely new object with only the fields Prisma expects
        // Do NOT include hoardingId or createdBy when using relations
        const cleanData: any = {};
        
        if (data.hoarding) cleanData.hoarding = data.hoarding;
        if (data.clientName !== undefined) cleanData.clientName = data.clientName;
        if (data.clientContact !== undefined) cleanData.clientContact = data.clientContact;
        if (data.status !== undefined) cleanData.status = data.status;
        if (data.startDate !== undefined) cleanData.startDate = data.startDate;
        if (data.endDate !== undefined) cleanData.endDate = data.endDate;
        if (data.price !== undefined) cleanData.price = data.price;
        if (data.createdByUser) cleanData.createdByUser = data.createdByUser;
        
        // Explicitly ensure hoardingId and createdBy are NOT in the data
        return prisma.booking.create({ data: cleanData });
    }

    async findByHoardingId(hoardingId: string): Promise<Booking[]> {
        return prisma.booking.findMany({
            where: { hoardingId },
            orderBy: { startDate: 'asc' },
        });
    }

    async findAll(): Promise<Booking[]> {
        return prisma.booking.findMany({
            include: {
                hoarding: {
                    select: {
                        id: true,
                        code: true,
                        city: true,
                        area: true,
                        title: true,
                    },
                },
                createdByUser: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
}
