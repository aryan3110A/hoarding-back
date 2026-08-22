import { prisma } from '../lib/prisma';

export type InquiryStatus = 'OPEN' | 'LOCKED' | 'CLOSED';
export type InquiryPerformanceStage =
  | 'IN_PROCESS'
  | 'WON'
  | 'FOLLOW_UP_LATER'
  | 'DEAD'
  | 'NOT_INTERESTED';
export type FollowupStatus = 'PENDING' | 'DONE';
export type InquirySource =
  | 'PHONE'
  | 'EMAIL'
  | 'MESSAGE'
  | 'WHATSAPP'
  | 'OTHER'
  | 'WALK_IN'
  | 'SELF_GENERATED'
  | 'VIA_TELEPHONIC'
  | 'VIA_WHATSAPP'
  | 'REFERENCE'
  | 'OTHERS';

export type InquiryRow = {
  id: string;
  clientName: string;
  companyName?: string | null;
  phone: string;
  email?: string | null;
  city: string;
  area: string;
  location: string;
  purpose?: string | null;
  status: InquiryStatus;
  performanceStage: InquiryPerformanceStage;
  source: InquirySource;
  firstContactDate?: Date | null;
  nextFollowupDate?: Date | null;
  followupStatus: FollowupStatus;
  assignedSalesId?: string | null;
  categoryId?: string | null;
  clientId?: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: {
    id: string;
    name: string;
    role?: { name: string } | null;
  };
  assignedSales?: {
    id: string;
    name: string;
    role?: { name: string } | null;
  } | null;
  category?: {
    id: string;
    name: string;
  } | null;
};

export class InquiryRepository {
  private get unsafe() {
    return prisma as unknown as {
      inquiry: {
        create: (args: unknown) => Promise<unknown>;
        findMany: (args?: unknown) => Promise<unknown>;
        findFirst: (args?: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<unknown>;
        findUnique: (args: unknown) => Promise<unknown>;
        count: (args?: unknown) => Promise<number>;
      };
      $transaction: (args: unknown[]) => Promise<unknown[]>;
    };
  }

  async findById(id: string): Promise<InquiryRow | null> {
    return this.unsafe.inquiry.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
        assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
      },
    } as unknown) as Promise<unknown> as unknown as Promise<InquiryRow | null>;
  }

  async create(data: Record<string, unknown>): Promise<InquiryRow> {
    return this.unsafe.inquiry.create({
      data,
      include: {
        createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
        assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
      },
    } as unknown) as Promise<unknown> as unknown as Promise<InquiryRow>;
  }

  async update(id: string, data: Record<string, unknown>): Promise<InquiryRow> {
    return this.unsafe.inquiry.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
        assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
      },
    } as unknown) as Promise<unknown> as unknown as Promise<InquiryRow>;
  }

  async findPotentialDuplicate(params: {
    phone: string;
    email?: string | null;
    city: string;
    area: string;
    location: string;
  }): Promise<InquiryRow | null> {
    const { phone, email, city, area, location } = params;

    const orClient: Array<Record<string, unknown>> = [{ phone }];
    if (email) orClient.push({ email });

    return this.unsafe.inquiry.findFirst({
      where: {
        status: { in: ['OPEN', 'LOCKED'] },
        AND: [
          { OR: orClient },
          { city: { equals: city, mode: 'insensitive' } },
          { area: { equals: area, mode: 'insensitive' } },
          { location: { equals: location, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
        assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
      },
    } as unknown) as Promise<unknown> as unknown as Promise<InquiryRow | null>;
  }

  async findLatestByPhone(phone: string): Promise<InquiryRow | null> {
    return this.unsafe.inquiry.findFirst({
      where: {
        status: { in: ['OPEN', 'LOCKED'] },
        phone,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
        assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
      },
    } as unknown) as Promise<unknown> as unknown as Promise<InquiryRow | null>;
  }

  async list(params: {
    skip: number;
    take: number;
    where: Record<string, unknown>;
  }): Promise<{ inquiries: InquiryRow[]; total: number }> {
    const { skip, take, where } = params;

    const [rows, total] = (await this.unsafe.$transaction([
      this.unsafe.inquiry.findMany({
        skip,
        take,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
          assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
          category: { select: { id: true, name: true } },
        },
      } as unknown),
      this.unsafe.inquiry.count({ where } as unknown),
    ])) as unknown as [InquiryRow[], number];

    return { inquiries: rows || [], total: total || 0 };
  }

  async listReminders(where: Record<string, unknown>): Promise<InquiryRow[]> {
    return this.unsafe.inquiry.findMany({
      where,
      orderBy: { nextFollowupDate: 'asc' },
      include: {
        createdBy: { select: { id: true, name: true, role: { select: { name: true } } } },
        assignedSales: { select: { id: true, name: true, role: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
      },
    } as unknown) as Promise<unknown> as unknown as Promise<InquiryRow[]>;
  }
}

export default new InquiryRepository();
