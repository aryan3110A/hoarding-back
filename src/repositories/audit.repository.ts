import { Prisma, AuditLog } from '@prisma/client';
import { prisma } from '../lib/prisma';

export class AuditRepository {
    async create(data: Prisma.AuditLogCreateInput): Promise<AuditLog> {
        return prisma.auditLog.create({ data });
    }
}
