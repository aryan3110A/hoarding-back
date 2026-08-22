import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class LocationRepository {
    async create(data: Prisma.LocationLogUncheckedCreateInput) {
        return prisma.locationLog.create({
            data,
        });
    }
}
