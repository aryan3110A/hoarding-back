import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';
import { BadRequestError, NotFoundError } from '../lib/errors';

type BillingFrequencyName = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';
type BillingEventStatusName =
  | 'UPCOMING_SCHEDULED'
  | 'TO_BE_GENERATED'
  | 'PO_PENDING'
  | 'OVERDUE'
  | 'COMPLETED';

const GST_RATE = new Prisma.Decimal(18);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const toNumber = (value: Prisma.Decimal | number | string | null | undefined) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
};

const getNetRevenueForNotification = (row: {
  baseAmount?: Prisma.Decimal | number | string | null;
  printingBase?: Prisma.Decimal | number | string | null;
  mountingBase?: Prisma.Decimal | number | string | null;
}) => toNumber(row.baseAmount) + toNumber(row.printingBase) + toNumber(row.mountingBase);

function decimal(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0);
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function normalizeDate(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() < day) {
    next.setDate(0);
  }
  return next;
}

function addByFrequency(date: Date, frequency: BillingFrequencyName, steps = 1) {
  if (frequency === 'QUARTERLY') return addMonths(date, 3 * steps);
  if (frequency === 'YEARLY') return addMonths(date, 12 * steps);
  if (frequency === 'ONE_TIME') return new Date(date);
  return addMonths(date, steps);
}

function toUploadUrl(filePath?: string | null) {
  if (!filePath) return null;
  const normalized = String(filePath).replace(/\\/g, '/');
  const marker = '/uploads/';
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) return normalized.slice(idx);
  const fallback = 'uploads/';
  const uploadsIdx = normalized.lastIndexOf(fallback);
  if (uploadsIdx >= 0) return `/${normalized.slice(uploadsIdx)}`;
  return null;
}

function monthsPerCycle(frequency: BillingFrequencyName) {
  if (frequency === 'QUARTERLY') return 3;
  if (frequency === 'YEARLY') return 12;
  if (frequency === 'ONE_TIME') return 0;
  return 1;
}

function toSquareFeetLabel(widthCm?: number | null, heightCm?: number | null) {
  if (!widthCm || !heightCm) return null;
  const widthFt = widthCm / 30.48;
  const heightFt = heightCm / 30.48;
  const areaSqFt = widthFt * heightFt;
  return `${widthFt.toFixed(2)} x ${heightFt.toFixed(2)} ft (${areaSqFt.toFixed(2)} sq ft)`;
}

function formatStatusCount(
  rows: Array<{ status: BillingEventStatusName; totalAmount: Prisma.Decimal }>,
) {
  const lookup = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    lookup.set(String(row.status), {
      count: (lookup.get(String(row.status))?.count || 0) + 1,
      amount: (lookup.get(String(row.status))?.amount || 0) + toNumber(row.totalAmount),
    });
  }
  return lookup;
}

export class BillingEventService {
  private notification: NotificationService;
  private userRepo: UserRepository;

  constructor() {
    this.notification = new NotificationService();
    this.userRepo = new UserRepository();
  }

  private getCycleCount(frequency: BillingFrequencyName, durationMonths: number) {
    if (frequency === 'ONE_TIME') return 1;
    const normalizedDuration = durationMonths > 0 ? durationMonths : 1;
    const perCycle = monthsPerCycle(frequency);
    if (perCycle <= 1) return normalizedDuration;
    return Math.max(1, Math.ceil(normalizedDuration / perCycle));
  }

  private getCycleMonthMultiplier(
    frequency: BillingFrequencyName,
    durationMonths: number,
    cycleNumber: number,
  ) {
    if (frequency === 'ONE_TIME') return Math.max(1, durationMonths || 1);
    const perCycle = monthsPerCycle(frequency);
    if (perCycle <= 1) return 1;
    const remaining = Math.max(1, durationMonths - (cycleNumber - 1) * perCycle);
    return Math.min(perCycle, remaining);
  }

  private async getAccountantIds() {
    const users = await this.userRepo.findByRoles(['accountant']);
    return users.map((row: { id?: string }) => String(row.id || '')).filter(Boolean);
  }

  private async getSalesHeadIds() {
    const users = await this.userRepo.findByRoles(['sales_head', 'sales head']);
    return users.map((row: { id?: string }) => String(row.id || '')).filter(Boolean);
  }

  private async getSalesPerformanceRecipientIds(salesUserId?: string | null) {
    const ids = new Set<string>();
    if (salesUserId) ids.add(String(salesUserId));
    const salesHeadIds = await this.getSalesHeadIds();
    salesHeadIds.forEach((id: string) => ids.add(String(id)));
    return Array.from(ids).filter(Boolean);
  }

  private getTriggerMoment(row: {
    dueAt: Date;
    liveEligibleAt?: Date | null;
    hoarding?: { actualLiveDate?: Date | null; billingStartDate?: Date | null } | null;
  }) {
    const dueAt = new Date(row.dueAt);
    const liveAnchor = row.liveEligibleAt
      ? new Date(row.liveEligibleAt)
      : row.hoarding?.billingStartDate
        ? new Date(row.hoarding.billingStartDate)
        : row.hoarding?.actualLiveDate
          ? new Date(row.hoarding.actualLiveDate)
          : null;
    if (!liveAnchor) return dueAt;
    return dueAt.getTime() > liveAnchor.getTime() ? dueAt : liveAnchor;
  }

  private async notifyBillDue(row: {
    id: string;
    client?: { name?: string | null } | null;
    hoarding?: { code?: string | null } | null;
    cycleNumber: number;
    dueAt: Date;
  }) {
    const recipientIds = await this.getAccountantIds();
    if (recipientIds.length === 0) return;
    const clientName = String(row.client?.name || 'Client');
    const hoardingCode = String(row.hoarding?.code || 'Hoarding');
    await this.notification.notifyUsersIdempotent(
      recipientIds,
      'Bill ready to generate',
      `${clientName} - ${hoardingCode} cycle ${row.cycleNumber} is ready for billing.`,
      '/dashboard/accountant',
      `billing_due:${row.id}`,
    );
  }

  private async notifyCycleCredited(row: {
    id: string;
    cycleNumber: number;
    periodStart: Date;
    periodEnd: Date;
    bookingToken?: { salesUserId?: string | null } | null;
    client?: { name?: string | null } | null;
    hoarding?: { code?: string | null } | null;
    baseAmount?: Prisma.Decimal | number | string | null;
    printingBase?: Prisma.Decimal | number | string | null;
    mountingBase?: Prisma.Decimal | number | string | null;
  }) {
    const recipientIds = await this.getSalesPerformanceRecipientIds(
      String(row.bookingToken?.salesUserId || '').trim() || null,
    );
    if (recipientIds.length === 0) return;
    const clientName = String(row.client?.name || 'Client');
    const hoardingCode = String(row.hoarding?.code || 'Hoarding');
    const amount = getNetRevenueForNotification(row);
    await this.notification.notifyUsersIdempotent(
      recipientIds,
      'Cycle credited',
      `Cycle credited: ${clientName}, ${hoardingCode}, Amount Rs ${amount.toFixed(2)}, Period ${row.periodStart.toLocaleDateString('en-IN')} - ${row.periodEnd.toLocaleDateString('en-IN')}.`,
      '/reports',
      `cycle_credited:${row.id}`,
    );
  }

  private async notifyCycleNotCredited(row: {
    id: string;
    cycleNumber: number;
    periodStart: Date;
    periodEnd: Date;
    bookingToken?: { salesUserId?: string | null } | null;
    client?: { name?: string | null } | null;
    hoarding?: { code?: string | null } | null;
  }) {
    const recipientIds = await this.getSalesPerformanceRecipientIds(
      String(row.bookingToken?.salesUserId || '').trim() || null,
    );
    if (recipientIds.length === 0) return;
    const clientName = String(row.client?.name || 'Client');
    const hoardingCode = String(row.hoarding?.code || 'Hoarding');
    await this.notification.notifyUsersIdempotent(
      recipientIds,
      'Cycle not credited',
      `Cycle not credited: ${clientName}, ${hoardingCode}. Hoarding is not live or has been unmounted for period ${row.periodStart.toLocaleDateString('en-IN')} - ${row.periodEnd.toLocaleDateString('en-IN')}.`,
      '/reports',
      `cycle_not_credited:${row.id}`,
    );
  }

  async syncQueueStatuses() {
    const rows = (await (prisma as any).billingEvent.findMany({
      where: {
        status: { in: ['UPCOMING_SCHEDULED', 'TO_BE_GENERATED'] },
      },
      include: {
        client: { select: { name: true } },
        bookingToken: { select: { salesUserId: true } },
        hoarding: {
          select: { code: true, status: true, actualLiveDate: true, billingStartDate: true },
        },
      },
      orderBy: [{ dueAt: 'asc' }],
    })) as Array<any>;

    const now = new Date();
    for (const row of rows) {
      const hoardingStatus = String(row?.hoarding?.status || '').toLowerCase();
      const isLive = hoardingStatus === 'live';
      const triggerMoment = this.getTriggerMoment(row);
      if (!isLive) {
        if (
          String(row.status) === 'UPCOMING_SCHEDULED' &&
          now.getTime() >= triggerMoment.getTime()
        ) {
          await this.notifyCycleNotCredited(row);
        }
        continue;
      }

      if (String(row.status) === 'UPCOMING_SCHEDULED' && now.getTime() >= triggerMoment.getTime()) {
        await (prisma as any).billingEvent.update({
          where: { id: row.id },
          data: {
            status: 'TO_BE_GENERATED',
            liveEligibleAt: triggerMoment,
            notificationSentAt: row.notificationSentAt || now,
          },
        });
        if (!row.notificationSentAt) {
          await this.notifyBillDue(row);
        }
        await this.notifyCycleCredited({
          ...row,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          bookingToken: row.bookingToken,
          baseAmount: row.baseAmount,
          printingBase: row.printingBase,
          mountingBase: row.mountingBase,
        });
        continue;
      }

      if (
        String(row.status) === 'TO_BE_GENERATED' &&
        now.getTime() - triggerMoment.getTime() >= ONE_DAY_MS
      ) {
        await (prisma as any).billingEvent.update({
          where: { id: row.id },
          data: {
            status: 'OVERDUE',
            liveEligibleAt: row.liveEligibleAt || triggerMoment,
            overdueAt: row.overdueAt || now,
          },
        });
      }
    }
  }

  async syncForToken(tokenId: string) {
    const token = (await (prisma as any).bookingToken.findUnique({
      where: { id: tokenId },
      include: {
        client: true,
        hoarding: true,
      },
    })) as any;

    if (!token) throw new NotFoundError('Booking token not found');
    if (!token.paymentPlanType || !token.billingFrequency || token.finalAgreedBasePrice === null) {
      return { synced: 0 };
    }

    const frequency = String(token.billingFrequency) as BillingFrequencyName;
    const durationMonths =
      typeof token.durationMonths === 'number' && token.durationMonths > 0
        ? token.durationMonths
        : 1;
    const billingAnchor = normalizeDate(
      token.hoarding?.billingStartDate ||
        token.hoarding?.billingStartOverrideDate ||
        token.plannedLiveDate ||
        token.dateFrom,
    );
    const liveDate = token.hoarding?.actualLiveDate
      ? normalizeDate(new Date(token.hoarding.actualLiveDate))
      : null;
    const cycleCount = this.getCycleCount(frequency, durationMonths);
    const baseRate = decimal(token.finalAgreedBasePrice);
    const printingBase = decimal(token.printingChargesBase);
    const mountingBase = decimal(token.mountingChargesBase);
    const gstApplicable = Boolean(token.gstApplicable);
    const totalBaseCampaignAmount = baseRate.mul(durationMonths || 1);
    const distributedBasePerCycle =
      cycleCount > 0 ? totalBaseCampaignAmount.div(cycleCount) : totalBaseCampaignAmount;
    const distributedPrintingPerCycle =
      cycleCount > 0 ? printingBase.div(cycleCount) : printingBase;
    const distributedMountingPerCycle =
      cycleCount > 0 ? mountingBase.div(cycleCount) : mountingBase;

    const cycleNumbers = Array.from({ length: cycleCount }, (_, idx) => idx + 1);
    for (const cycleNumber of cycleNumbers) {
      const periodStart =
        frequency === 'ONE_TIME'
          ? new Date(billingAnchor)
          : addByFrequency(billingAnchor, frequency, cycleNumber - 1);
      const periodEnd =
        frequency === 'ONE_TIME'
          ? new Date(token.dateTo || token.dateFrom || billingAnchor)
          : addDays(addByFrequency(billingAnchor, frequency, cycleNumber), -1);
      const dueAt =
        cycleNumber === 1 ? new Date(billingAnchor) : addDays(new Date(periodStart), -1);
      const eventBase = distributedBasePerCycle;
      const currentPrintingBase = distributedPrintingPerCycle;
      const currentMountingBase = distributedMountingPerCycle;
      const gstAmount = gstApplicable ? eventBase.mul(GST_RATE).div(100) : new Prisma.Decimal(0);
      const printingGst = gstApplicable
        ? currentPrintingBase.mul(GST_RATE).div(100)
        : new Prisma.Decimal(0);
      const mountingGst = gstApplicable
        ? currentMountingBase.mul(GST_RATE).div(100)
        : new Prisma.Decimal(0);
      const printingTotal = currentPrintingBase.plus(printingGst);
      const mountingTotal = currentMountingBase.plus(mountingGst);
      const totalAmount = eventBase.plus(gstAmount).plus(printingTotal).plus(mountingTotal);

      const existing = (await (prisma as any).billingEvent.findFirst({
        where: { bookingTokenId: token.id, cycleNumber },
      })) as any;

      const derivedStatus: BillingEventStatusName =
        liveDate &&
        cycleNumber === 1 &&
        !['PO_PENDING', 'OVERDUE', 'COMPLETED'].includes(String(existing?.status || ''))
          ? 'TO_BE_GENERATED'
          : existing?.status || 'UPCOMING_SCHEDULED';

      await (prisma as any).billingEvent.upsert({
        where: {
          bookingTokenId_cycleNumber: {
            bookingTokenId: token.id,
            cycleNumber,
          },
        },
        create: {
          hoardingId: token.hoardingId,
          bookingTokenId: token.id,
          clientId: token.clientId,
          cycleNumber,
          status: derivedStatus,
          periodStart,
          periodEnd,
          dueAt,
          billingAnchorDate: billingAnchor,
          liveEligibleAt: derivedStatus === 'TO_BE_GENERATED' ? liveDate || dueAt : null,
          baseAmount: eventBase,
          gstApplicable,
          gstRatePct: GST_RATE,
          gstAmount,
          totalAmount,
          printingBase: currentPrintingBase,
          printingGst,
          printingTotal,
          mountingBase: currentMountingBase,
          mountingGst,
          mountingTotal,
          paymentPlanType: token.paymentPlanType,
          billingFrequency: token.billingFrequency,
          modeOfPayment: token.modeOfPayment || null,
        },
        update: {
          periodStart,
          periodEnd,
          dueAt,
          billingAnchorDate: billingAnchor,
          baseAmount: eventBase,
          gstApplicable,
          gstRatePct: GST_RATE,
          gstAmount,
          totalAmount,
          printingBase: currentPrintingBase,
          printingGst,
          printingTotal,
          mountingBase: currentMountingBase,
          mountingGst,
          mountingTotal,
          paymentPlanType: token.paymentPlanType,
          billingFrequency: token.billingFrequency,
          modeOfPayment: token.modeOfPayment || null,
          status:
            existing?.status === 'PO_PENDING' ||
            existing?.status === 'OVERDUE' ||
            existing?.status === 'COMPLETED'
              ? existing.status
              : derivedStatus,
          liveEligibleAt:
            existing?.liveEligibleAt ||
            (derivedStatus === 'TO_BE_GENERATED' ? liveDate || dueAt : null),
        },
      });
    }

    await (prisma as any).billingEvent.deleteMany({
      where: {
        bookingTokenId: token.id,
        cycleNumber: { notIn: cycleNumbers },
        status: { notIn: ['COMPLETED'] },
      },
    });

    await this.syncQueueStatuses();
    return { synced: cycleNumbers.length };
  }

  async activateForLive(hoardingId: string) {
    const hoarding = (await (prisma as any).hoarding.findUnique({
      where: { id: hoardingId },
      select: {
        id: true,
        code: true,
        status: true,
        actualLiveDate: true,
        billingStartDate: true,
      },
    })) as any;
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const token = (await (prisma as any).bookingToken.findFirst({
      where: {
        hoardingId,
        status: { in: ['CONFIRMED', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })) as { id?: string } | null;

    if (!token?.id) return { activated: 0 };

    await this.syncForToken(String(token.id));
    const firstEvent = (await (prisma as any).billingEvent.findFirst({
      where: { bookingTokenId: token.id, cycleNumber: 1 },
      include: {
        client: { select: { name: true } },
        hoarding: { select: { code: true } },
      },
    })) as any;

    if (firstEvent && String(firstEvent.status) !== 'COMPLETED') {
      await (prisma as any).billingEvent.update({
        where: { id: firstEvent.id },
        data: {
          status: 'TO_BE_GENERATED',
          liveEligibleAt:
            hoarding.billingStartDate ||
            hoarding.actualLiveDate ||
            firstEvent.liveEligibleAt ||
            new Date(),
          notificationSentAt: firstEvent.notificationSentAt || new Date(),
        },
      });
      if (!firstEvent.notificationSentAt) {
        await this.notifyBillDue(firstEvent);
      }
    }

    await this.syncQueueStatuses();
    return { activated: firstEvent ? 1 : 0 };
  }

  async getQueueSummary() {
    await this.syncQueueStatuses();

    const [invoiceAgg, billingRows] = await Promise.all([
      prisma.invoice.aggregate({
        _sum: { subtotal: true, totalAmount: true },
        _count: { id: true },
      }),
      (prisma as any).billingEvent.findMany({
        select: {
          status: true,
          totalAmount: true,
        },
      }),
    ]);

    const summaryLookup = formatStatusCount(billingRows as Array<any>);
    const toBeGenerated = summaryLookup.get('TO_BE_GENERATED') || { count: 0, amount: 0 };
    const poPending = summaryLookup.get('PO_PENDING') || { count: 0, amount: 0 };
    const upcoming = summaryLookup.get('UPCOMING_SCHEDULED') || { count: 0, amount: 0 };
    const overdue = summaryLookup.get('OVERDUE') || { count: 0, amount: 0 };
    const completed = summaryLookup.get('COMPLETED') || { count: 0, amount: 0 };

    return {
      totalBillingDoneBase: toNumber(invoiceAgg._sum.subtotal),
      totalBillingDoneWithGst: toNumber(invoiceAgg._sum.totalAmount),
      totalBillsGenerated: invoiceAgg._count.id || 0,
      toBeGenerated,
      pending: {
        count: poPending.count + upcoming.count,
        amount: poPending.amount + upcoming.amount,
        poPending,
        upcomingScheduled: upcoming,
      },
      overdue,
      completed,
    };
  }

  async listQueue(params?: { tab?: string; clientId?: string }) {
    await this.syncQueueStatuses();

    const tab = String(params?.tab || 'to_be_generated').toLowerCase();
    const statuses =
      tab === 'pending'
        ? ['UPCOMING_SCHEDULED', 'PO_PENDING']
        : tab === 'overdue'
          ? ['OVERDUE']
          : tab === 'completed'
            ? ['COMPLETED']
            : ['TO_BE_GENERATED'];

    const where: Record<string, unknown> = {
      status: { in: statuses },
    };
    if (params?.clientId) where.clientId = params.clientId;

    const orderBy =
      tab === 'completed'
        ? [{ completedAt: 'desc' }, { dueAt: 'desc' }]
        : tab === 'overdue'
          ? [{ overdueAt: 'desc' }, { dueAt: 'asc' }]
          : [{ dueAt: 'asc' }, { cycleNumber: 'asc' }];

    const rows = (await (prisma as any).billingEvent.findMany({
      where,
      include: {
        client: true,
        hoarding: true,
        bookingToken: true,
        invoice: true,
      },
      orderBy,
    })) as Array<any>;

    const grouped = new Map<string, any>();
    for (const row of rows) {
      const clientId = String(row.clientId);
      const clientName = String(row.client?.name || 'Unknown Client');
      const partyName = String(
        row.client?.billingCompanyName ||
          row.client?.companyName ||
          row.client?.name ||
          'Unknown Party',
      );
      const billingPhone = row.client?.billingPhone || row.client?.phone || null;
      const billingEmail = row.client?.billingEmail || row.client?.email || null;
      const bucket = grouped.get(clientId) || {
        clientId,
        clientName,
        partyName,
        partyDetails: {
          billingCompanyName: row.client?.billingCompanyName || row.client?.companyName || null,
          clientName,
          gstin: row.client?.gstin || null,
          billingPhone,
          billingEmail,
          billingAddress: row.client?.billingAddress || null,
        },
        totals: { base: 0, gst: 0, withGst: 0 },
        rows: [],
      };

      bucket.totals.base += toNumber(row.baseAmount);
      bucket.totals.gst +=
        toNumber(row.gstAmount) + toNumber(row.printingGst) + toNumber(row.mountingGst);
      bucket.totals.withGst += toNumber(row.totalAmount);
      bucket.rows.push({
        id: row.id,
        hoardingId: row.hoardingId,
        code: row.hoarding?.code || 'NA',
        city: row.hoarding?.city || null,
        area: row.hoarding?.area || null,
        landmark: row.hoarding?.landmark || null,
        facingDirection: row.hoarding?.side || null,
        size:
          row.hoarding?.widthCm && row.hoarding?.heightCm
            ? `${row.hoarding.widthCm} × ${row.hoarding.heightCm} cm`
            : null,
        sizeSquareFeet: toSquareFeetLabel(row.hoarding?.widthCm, row.hoarding?.heightCm),
        position: row.hoarding?.roadName || null,
        hoardingType: row.hoarding?.type || null,
        illumination: null,
        billingDetails: {
          partyName,
          clientName,
          billingCompanyName: row.client?.billingCompanyName || row.client?.companyName || null,
          billingPhone,
          billingEmail,
          gstin: row.client?.gstin || null,
          billingAddress: row.client?.billingAddress || null,
          finalAgreedPriceBase: toNumber(row.baseAmount),
          gstApplicable: Boolean(row.gstApplicable),
          gstAmount:
            toNumber(row.gstAmount) + toNumber(row.printingGst) + toNumber(row.mountingGst),
          totalWithGst: toNumber(row.totalAmount),
          durationMonths: row.bookingToken?.durationMonths || 0,
          billingFrequency: row.billingFrequency,
          paymentPlanType: row.paymentPlanType,
          modeOfPayment: row.modeOfPayment || row.bookingToken?.modeOfPayment || null,
          printingChargesBase: toNumber(row.printingBase),
          printingChargesGst: toNumber(row.printingGst),
          printingChargesTotal: toNumber(row.printingTotal),
          mountingChargesBase: toNumber(row.mountingBase),
          mountingChargesGst: toNumber(row.mountingGst),
          mountingChargesTotal: toNumber(row.mountingTotal),
          billingPeriodStart: row.periodStart,
          billingPeriodEnd: row.periodEnd,
          nextDueTriggerDate: row.dueAt,
          status: row.status,
          billNumber: row.billNumber || row.invoice?.invoiceNumber || null,
          invoiceNumber: row.invoice?.invoiceNumber || null,
          invoiceStatus: row.invoice?.status || null,
          billingFirm: row.invoice?.billingFirm || null,
          billPdfUrl: toUploadUrl(row.invoice?.billPdfPath),
          generatedAt: row.completedAt || row.invoice?.createdAt || null,
          generatedRemarks: row.remarks || row.invoice?.notes || null,
          paidAmount: toNumber(row.invoice?.paidAmount),
        },
        warningNotLive: String(row.hoarding?.status || '').toLowerCase() !== 'live',
      });
      grouped.set(clientId, bucket);
    }

    return {
      tab,
      groups: Array.from(grouped.values()).sort((a, b) =>
        String(a.partyName || a.clientName).localeCompare(String(b.partyName || b.clientName)),
      ),
    };
  }

  async markPoPending(eventId: string) {
    const existing = (await (prisma as any).billingEvent.findUnique({
      where: { id: eventId },
    })) as any;
    if (!existing) throw new NotFoundError('Billing event not found');
    if (String(existing.status) === 'COMPLETED') {
      throw new BadRequestError('Completed bill cannot be moved to PO Pending');
    }
    return (prisma as any).billingEvent.update({
      where: { id: eventId },
      data: {
        status: 'PO_PENDING',
        poPendingAt: existing.poPendingAt || new Date(),
      },
    });
  }

  async generateInvoiceForEvents(
    payload: {
      eventIds: string[];
      firmName: string;
      billNumber: string;
      remarks?: string;
    },
    actorId: string,
    billPdfPath?: string | null,
  ) {
    const eventIds = Array.from(
      new Set((payload.eventIds || []).map((value) => String(value || '')).filter(Boolean)),
    );
    if (eventIds.length === 0) throw new BadRequestError('Select at least one billing item');

    const firmName = String(payload.firmName || '').trim();
    const billNumber = String(payload.billNumber || '').trim();
    const remarks = String(payload.remarks || '').trim();
    if (!firmName) throw new BadRequestError('Firm is required');
    if (!billNumber) throw new BadRequestError('Bill number is required');

    const existingInvoice = await prisma.invoice.findUnique({
      where: { invoiceNumber: billNumber },
      select: { id: true },
    });
    if (existingInvoice) throw new BadRequestError('Bill number already exists');

    const events = await (prisma as any).billingEvent.findMany({
      where: { id: { in: eventIds } },
      include: {
        client: true,
        hoarding: true,
        bookingToken: true,
      },
    });

    if ((events || []).length !== eventIds.length) {
      throw new BadRequestError('Some selected billing items were not found');
    }

    const firstClientId = String(events[0]?.clientId || '');
    if (!firstClientId) throw new BadRequestError('Billing items are missing a client');

    for (const event of events) {
      if (String(event.clientId) !== firstClientId) {
        throw new BadRequestError('Selected billing items must belong to the same client');
      }
      if (event.invoiceId || String(event.status) === 'COMPLETED') {
        throw new BadRequestError('One or more selected billing items are already billed');
      }
    }

    const subtotal = events.reduce(
      (acc: Prisma.Decimal, event: any) =>
        acc
          .plus(decimal(event.baseAmount))
          .plus(decimal(event.printingBase))
          .plus(decimal(event.mountingBase)),
      new Prisma.Decimal(0),
    );
    const taxAmount = events.reduce(
      (acc: Prisma.Decimal, event: any) =>
        acc
          .plus(decimal(event.gstAmount))
          .plus(decimal(event.printingGst))
          .plus(decimal(event.mountingGst)),
      new Prisma.Decimal(0),
    );
    const totalAmount = subtotal.plus(taxAmount);
    const now = new Date();

    const createdInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: billNumber,
          clientId: firstClientId,
          billingFirm: firmName,
          billPdfPath: billPdfPath || null,
          subtotal,
          taxAmount,
          totalAmount,
          status: 'ISSUED',
          notes: remarks || null,
          createdById: actorId,
        },
      });

      await (tx as any).billingEvent.updateMany({
        where: { id: { in: eventIds } },
        data: {
          invoiceId: invoice.id,
          status: 'COMPLETED',
          completedAt: now,
          remarks: remarks || null,
        },
      });

      return invoice;
    });

    try {
      const recipients = (await this.userRepo.findByRoles(['owner', 'manager', 'admin'])) as Array<{
        id?: string;
      }>;
      const ids = recipients.map((u) => u.id).filter((id): id is string => Boolean(id));
      if (ids.length > 0) {
        await this.notification.notifyUsersIdempotent(
          ids,
          'Bill Generated',
          `Bill ${billNumber} generated for ${events[0]?.client?.name || 'client'}.`,
          '/dashboard/accountant',
          `BILL_GENERATED:${createdInvoice.id}`,
        );
      }
    } catch (_) {}

    return {
      invoice: createdInvoice,
      billedEventIds: eventIds,
      totals: {
        subtotal: toNumber(subtotal),
        taxAmount: toNumber(taxAmount),
        totalAmount: toNumber(totalAmount),
      },
    };
  }

  async listFirmOptions() {
    const defaults = ['Firm A', 'Firm B', 'Firm C'];
    const rows = await prisma.invoice.findMany({
      where: { billingFirm: { not: null } },
      select: { billingFirm: true },
      distinct: ['billingFirm'],
      orderBy: { billingFirm: 'asc' },
      take: 100,
    });

    return Array.from(
      new Set([
        ...defaults,
        ...rows
          .map((row: { billingFirm: string | null }) => String(row.billingFirm || '').trim())
          .filter(Boolean),
      ]),
    );
  }
}
