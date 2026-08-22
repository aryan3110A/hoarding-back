/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '../lib/prisma';

export type ClientCreateInput = {
  name: string;
  phone: string;
  email?: string | null;
  companyName?: string | null;
  billingCompanyName?: string | null;
  billingPhone?: string | null;
  billingEmail?: string | null;
  gstin?: string | null;
  billingAddress?: string | null;
  createdById?: string | null;
};

export class ClientRepository {
  async findById(id: string): Promise<unknown | null> {
    return (prisma as any).client.findUnique({ where: { id } });
  }
  async findByPhone(phone: string): Promise<unknown | null> {
    return (prisma as any).client.findUnique({ where: { phone } });
  }

  async create(data: ClientCreateInput): Promise<unknown> {
    return (prisma as any).client.create({ data });
  }

  async update(id: string, data: Partial<ClientCreateInput>): Promise<unknown> {
    return (prisma as any).client.update({ where: { id }, data });
  }

  async findAll(params?: { skip?: number; take?: number; where?: any }): Promise<unknown[]> {
    const skip = params?.skip || 0;
    const take = params?.take || 100;
    const where = params?.where || { isActive: true };
    return (prisma as any).client.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } });
  }

  async search(q: string, take = 10): Promise<unknown[]> {
    const query = String(q || '').trim();
    if (!query) return [];
    const safeTake = Math.min(Math.max(Number(take) || 10, 1), 25);
    return (prisma as any).client.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: safeTake,
      orderBy: [{ name: 'asc' }],
    });
  }
}
