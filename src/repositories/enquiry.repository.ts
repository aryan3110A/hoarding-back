import { prisma } from '../lib/prisma';

export class EnquiryRepository {
  private get unsafe() {
    return prisma as unknown as {
      enquiry: {
        create: (args: unknown) => Promise<unknown>;
        findMany: (args?: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<unknown>;
        findUnique: (args: unknown) => Promise<unknown>;
      };
    };
  }

  async create(data: any) {
    return this.unsafe.enquiry.create({ data } as any) as Promise<any>;
  }

  async listAll() {
    return this.unsafe.enquiry.findMany({ orderBy: { createdAt: 'desc' } } as any) as Promise<
      any[]
    >;
  }

  async findById(id: string) {
    return this.unsafe.enquiry.findUnique({ where: { id } } as any) as Promise<any>;
  }

  async update(id: string, data: any) {
    return this.unsafe.enquiry.update({ where: { id }, data } as any) as Promise<any>;
  }
}

export default new EnquiryRepository();
