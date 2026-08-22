import { prisma } from '../lib/prisma';
import { Prisma, PropertyRent } from '@prisma/client';

export class PropertyRentRepository {
  async findById(id: string): Promise<PropertyRent | null> {
    return prisma.propertyRent.findUnique({
      where: { id },
      include: { hoardings: true },
    });
  }

  async findByLandlord(landlordName: string): Promise<PropertyRent | null> {
    const landlord = String(landlordName || '').trim();
    if (!landlord) return null;
    return prisma.propertyRent.findFirst({
      where: {
        landlord: {
          equals: landlord,
          mode: 'insensitive',
        },
      },
      orderBy: { updatedAt: 'desc' },
      include: { hoardings: true },
    });
  }

  async findByGroupId(propertyGroupId: string): Promise<PropertyRent | null> {
    return prisma.propertyRent.findUnique({
      where: { propertyGroupId },
      include: { hoardings: true },
    });
  }

  async create(data: Prisma.PropertyRentCreateInput): Promise<PropertyRent> {
    return prisma.propertyRent.create({ data, include: { hoardings: true } });
  }

  async update(id: string, data: Prisma.PropertyRentUpdateInput): Promise<PropertyRent> {
    return prisma.propertyRent.update({
      where: { id },
      data,
      include: { hoardings: true },
    });
  }

  async createPayment(data: {
    propertyRentId: string;
    landlord?: string | null;
    dueDate: Date;
    rentAmountDue: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    paymentDate: Date;
    paymentMode: string;
    remarks?: string | null;
    screenshotUrl?: string | null;
    screenshotPath?: string | null;
    recordedById?: string | null;
  }) {
    return prisma.landlordRentPayment.create({
      data: {
        propertyRentId: data.propertyRentId,
        landlord: data.landlord || null,
        dueDate: data.dueDate,
        rentAmountDue: data.rentAmountDue,
        amountPaid: data.amountPaid,
        paymentDate: data.paymentDate,
        paymentMode: data.paymentMode,
        remarks: data.remarks || null,
        screenshotUrl: data.screenshotUrl || null,
        screenshotPath: data.screenshotPath || null,
        recordedById: data.recordedById || null,
      },
    });
  }

  async sumPaymentsBetween(start: Date, end: Date) {
    const agg = await prisma.landlordRentPayment.aggregate({
      where: {
        paymentDate: {
          gte: start,
          lte: end,
        },
      },
      _sum: { amountPaid: true },
    });
    return Number(agg._sum.amountPaid || 0);
  }

  async list(params: { skip?: number; take?: number } = {}) {
    const { skip, take } = params;
    const [rows, total] = await prisma.$transaction([
      prisma.propertyRent.findMany({
        skip,
        take,
        orderBy: { nextDueDate: 'asc' },
        include: { hoardings: true },
      }),
      prisma.propertyRent.count(),
    ]);
    return { rows, total };
  }

  async listByLandlord() {
    return prisma.propertyRent.findMany({
      where: {
        landlord: {
          not: null,
        },
      },
      orderBy: { updatedAt: 'desc' },
      include: { hoardings: true },
    });
  }

  async upcomingDues(daysAhead: number) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(now);
    target.setDate(target.getDate() + daysAhead);
    target.setHours(23, 59, 59, 999);
    return prisma.propertyRent.findMany({
      where: { nextDueDate: { gte: now, lte: target } },
      orderBy: { nextDueDate: 'asc' },
      include: { hoardings: true },
    });
  }

  async overdueDues() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return prisma.propertyRent.findMany({
      where: { nextDueDate: { lt: now } },
      orderBy: { nextDueDate: 'asc' },
      include: { hoardings: true },
    });
  }
}
