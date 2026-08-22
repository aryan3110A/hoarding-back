/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '../lib/prisma';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';

const legacySelect = {
  id: true,
  hoardingId: true,
  dateFrom: true,
  dateTo: true,
  plannedLiveDate: true,
  salesUserId: true,
  clientId: true,
  status: true,
  queuePosition: true,
  expiresAt: true,
  createdAt: true,
  durationMonths: true,
  notes: true,
  paymentPlanType: true,
  billingFrequency: true,
  gstApplicable: true,
  finalAgreedBasePrice: true,
  modeOfPayment: true,
  printingChargesBase: true,
  mountingChargesBase: true,
  poRequired: true,
  poNotes: true,
  expectedPoDate: true,
  designerId: true,
  designStatus: true,
  designNotes: true,
  fitterId: true,
  fitterStatus: true,
  fitterNotes: true,
  fitterAssignedAt: true,
  fitterStartedAt: true,
  fitterCompletedAt: true,
  installationImages: true,
} as const;

const phase3Select = {
  ...legacySelect,
  blockedAt: true,
  blockDurationHours: true,
  extensionRequestedAt: true,
  extensionRequestedUntil: true,
  extensionApprovedAt: true,
  extensionApprovedById: true,
  releasedAt: true,
  releasedById: true,
  releaseReason: true,
} as const;

async function getTokenSelect() {
  return (await supportsPhase3BlockingSchema()) ? phase3Select : legacySelect;
}

async function getBlockingStatuses() {
  return (await supportsPhase3BlockingSchema())
    ? (['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] as const)
    : (['ACTIVE'] as const);
}

async function getActiveBlockedStatuses() {
  return (await supportsPhase3BlockingSchema())
    ? (['BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] as const)
    : (['ACTIVE'] as const);
}

async function getDesignerFitterStatuses() {
  return (await supportsPhase3BlockingSchema())
    ? (['CONFIRMED', 'APPROVED'] as const)
    : (['CONFIRMED', 'APPROVED'] as const);
}

export class BookingTokenRepository {
  async create(data: Record<string, unknown>): Promise<unknown> {
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.create({ data, select });
  }

  async findActiveOverlaps(hoardingId: string, from: Date, to: Date): Promise<unknown[]> {
    const statuses = await getActiveBlockedStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: {
        hoardingId,
        status: { in: statuses },
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
      },
      orderBy: { queuePosition: 'asc' },
      select,
    });
  }

  async findQueue(hoardingId: string, from: Date, to: Date): Promise<unknown[]> {
    const statuses = await getBlockingStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: {
        hoardingId,
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
        status: { in: statuses },
      },
      orderBy: { queuePosition: 'asc' },
      select,
    });
  }

  async updateStatus(
    id: string,
    status:
      | 'ACTIVE'
      | 'CONFIRMED'
      | 'PENDING'
      | 'BLOCKED'
      | 'EXTENSION_REQUESTED'
      | 'APPROVED'
      | 'EXPIRED'
      | 'RELEASED'
      | 'CANCELLED',
  ): Promise<unknown> {
    const supports = await supportsPhase3BlockingSchema();
    if (!supports) {
      // Map unsupported Phase-3 statuses to legacy equivalents
      if (status === 'PENDING' || status === 'BLOCKED' || status === 'EXTENSION_REQUESTED') {
        status = 'ACTIVE';
      } else if (status === 'APPROVED') {
        status = 'CONFIRMED';
      } else if (status === 'RELEASED') {
        status = 'CANCELLED';
      }
    }
    return (prisma as any).bookingToken.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  }

  async setQueuePosition(id: string, pos: number): Promise<unknown> {
    return (prisma as any).bookingToken.update({
      where: { id },
      data: { queuePosition: pos },
      select: { id: true, queuePosition: true },
    });
  }

  async listMine(userId: string): Promise<unknown[]> {
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: { salesUserId: userId },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }

  async findExpiredBlocked(now: Date): Promise<unknown[]> {
    const statuses = await getActiveBlockedStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: {
        status: { in: statuses },
        expiresAt: { lt: now },
      },
      select,
    });
  }

  async findBlockingByHoardingAndSales(
    hoardingId: string,
    salesUserId: string,
    from: Date,
    to: Date,
  ): Promise<unknown | null> {
    const statuses = await getBlockingStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findFirst({
      where: {
        hoardingId,
        salesUserId,
        status: { in: statuses },
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
      },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }

  async findNextActiveInQueue(hoardingId: string, from: Date, to: Date): Promise<unknown | null> {
    const supports = await supportsPhase3BlockingSchema();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findFirst({
      where: {
        hoardingId,
        status: { in: supports ? ['PENDING', 'ACTIVE'] : ['ACTIVE'] },
        OR: [{ AND: [{ dateFrom: { lte: to } }, { dateTo: { gte: from } }] }],
      },
      orderBy: { queuePosition: 'asc' },
      select,
    });
  }

  async findActiveByHoarding(hoardingId: string): Promise<unknown[]> {
    const now = new Date();
    const statuses = await getActiveBlockedStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: {
        hoardingId,
        status: { in: statuses },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }

  async findActiveByHoardingAndSales(
    hoardingId: string,
    salesUserId: string,
  ): Promise<unknown | null> {
    const now = new Date();
    const statuses = await getActiveBlockedStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findFirst({
      where: {
        hoardingId,
        salesUserId,
        status: { in: statuses },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }

  async findById(id: string): Promise<unknown | null> {
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findUnique({ where: { id }, select });
  }

  async findDetailsById(id: string): Promise<unknown | null> {
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findUnique({
      where: { id },
      select: {
        ...select,
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true, phone: true, email: true } },
        designer: { select: { id: true, name: true, phone: true, email: true } },
        fitter: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  async listAssignedToDesigner(designerId: string): Promise<unknown[]> {
    const statuses = await getDesignerFitterStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: { designerId, status: { in: statuses } },
      orderBy: { createdAt: 'desc' },
      select: {
        ...select,
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        fitter: { select: { id: true, name: true } },
      },
    });
  }

  async listAssignedToFitter(fitterId: string): Promise<unknown[]> {
    const statuses = await getDesignerFitterStatuses();
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where: { fitterId, status: { in: statuses } },
      orderBy: { createdAt: 'desc' },
      select: {
        ...select,
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        fitter: { select: { id: true, name: true } },
      },
    });
  }

  async listRecent(filters: {
    from?: Date;
    to?: Date;
    hoardingId?: string;
    salesUserId?: string;
    take?: number;
  }): Promise<unknown[]> {
    const where: any = {};
    if (filters.hoardingId) where.hoardingId = filters.hoardingId;
    if (filters.salesUserId) where.salesUserId = filters.salesUserId;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    const select = await getTokenSelect();
    return (prisma as any).bookingToken.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: typeof filters.take === 'number' ? filters.take : 50,
      select: {
        ...select,
        client: true,
        hoarding: true,
        salesUser: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        fitter: { select: { id: true, name: true } },
      },
    });
  }
}
