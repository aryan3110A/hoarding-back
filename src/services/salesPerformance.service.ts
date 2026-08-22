import { Prisma } from '@prisma/client';
import { BadRequestError, ForbiddenError } from '../lib/errors';
import { prisma } from '../lib/prisma';

type GroupBy = 'day' | 'month';

type SalesPerformanceScope = {
  startDate: Date;
  endDate: Date;
  groupBy: GroupBy;
  visibility: 'self' | 'team';
  salespersonId: string | null;
};

const MANAGEMENT_ROLES = new Set(['admin', 'owner', 'manager', 'sales_head', 'sales head']);

const RECOGNIZED_BILLING_STATUSES = ['TO_BE_GENERATED', 'PO_PENDING', 'OVERDUE', 'COMPLETED'];
const FUTURE_BILLING_STATUSES = ['UPCOMING_SCHEDULED', 'TO_BE_GENERATED', 'PO_PENDING', 'OVERDUE'];
const DEAD_FOLLOW_UP_LATER_STAGES = ['DEAD', 'FOLLOW_UP_LATER'];

const toNumber = (value: Prisma.Decimal | number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return 0;
  return Number(value);
};

const startOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
};

const startOfMonth = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);

const endOfMonth = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);

const formatBucketKey = (value: Date, groupBy: GroupBy) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  if (groupBy === 'month') return `${year}-${month}`;
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatPreviewMonth = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
};

const getRecognitionDate = (row: { liveEligibleAt?: Date | null; dueAt: Date }) =>
  row.liveEligibleAt || row.dueAt;

const getNetRevenue = (row: {
  baseAmount?: Prisma.Decimal | number | string | null;
  printingBase?: Prisma.Decimal | number | string | null;
  mountingBase?: Prisma.Decimal | number | string | null;
}) => toNumber(row.baseAmount) + toNumber(row.printingBase) + toNumber(row.mountingBase);

const getFunnelStage = (value: unknown) =>
  String(value || 'IN_PROCESS')
    .trim()
    .toUpperCase();

export class SalesPerformanceService {
  private unsafe = prisma as unknown as {
    salesMarketVisit: {
      findMany: (args?: unknown) => Promise<unknown>;
      upsert: (args: unknown) => Promise<unknown>;
    };
  };

  private resolveScope(params: {
    startDate?: string;
    endDate?: string;
    groupBy?: string;
    salespersonId?: string;
    currentUserId?: string;
    currentRole?: string;
  }): SalesPerformanceScope {
    const now = new Date();
    const parsedStart = params.startDate ? new Date(params.startDate) : startOfMonth(now);
    const parsedEnd = params.endDate ? new Date(params.endDate) : endOfMonth(now);
    const startDate = startOfDay(parsedStart);
    const endDate = endOfDay(parsedEnd);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestError('Invalid sales performance date range');
    }
    if (startDate.getTime() > endDate.getTime()) {
      throw new BadRequestError('Start date cannot be after end date');
    }

    const currentRole = String(params.currentRole || '')
      .trim()
      .toLowerCase();
    const isManagement = MANAGEMENT_ROLES.has(currentRole);
    const requestedSalespersonId = String(params.salespersonId || '').trim() || null;

    if (
      !isManagement &&
      requestedSalespersonId &&
      requestedSalespersonId !== params.currentUserId
    ) {
      throw new ForbiddenError('You can only view your own sales performance');
    }

    const daySpan = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const requestedGroupBy = String(params.groupBy || '')
      .trim()
      .toLowerCase();
    const groupBy: GroupBy =
      requestedGroupBy === 'day' || requestedGroupBy === 'month'
        ? (requestedGroupBy as GroupBy)
        : daySpan > 45
          ? 'month'
          : 'day';

    return {
      startDate,
      endDate,
      groupBy,
      visibility: isManagement ? 'team' : 'self',
      salespersonId: isManagement ? requestedSalespersonId : params.currentUserId || null,
    };
  }

  private buildSalesTokenFilter(scope: SalesPerformanceScope) {
    return scope.salespersonId ? { bookingToken: { salesUserId: scope.salespersonId } } : {};
  }

  private buildInquiryFilter(scope: SalesPerformanceScope) {
    if (!scope.salespersonId) {
      return {
        createdAt: { gte: scope.startDate, lte: scope.endDate },
      };
    }

    return {
      createdAt: { gte: scope.startDate, lte: scope.endDate },
      OR: [{ assignedSalesId: scope.salespersonId }, { createdById: scope.salespersonId }],
    };
  }

  private buildMarketVisitFilter(scope: SalesPerformanceScope) {
    return {
      visitDate: { gte: scope.startDate, lte: scope.endDate },
      ...(scope.salespersonId ? { userId: scope.salespersonId } : {}),
    };
  }

  async getOverview(params: {
    startDate?: string;
    endDate?: string;
    groupBy?: string;
    salespersonId?: string;
    currentUserId?: string;
    currentRole?: string;
  }) {
    const scope = this.resolveScope(params);
    const salesTokenFilter = this.buildSalesTokenFilter(scope);

    const [allEvents, inquiries, marketVisits] = await Promise.all([
      prisma.billingEvent.findMany({
        where: salesTokenFilter as any,
        orderBy: [{ dueAt: 'asc' }],
        include: {
          bookingToken: {
            select: {
              id: true,
              salesUserId: true,
              salesUser: { select: { id: true, name: true } },
            },
          },
          client: { select: { id: true, name: true } },
          hoarding: { select: { id: true, code: true } },
        },
      }) as Promise<Array<any>>,
      prisma.inquiry.findMany({
        where: this.buildInquiryFilter(scope) as any,
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          source: true,
          createdAt: true,
          assignedSalesId: true,
          createdById: true,
          performanceStage: true,
          assignedSales: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }) as Promise<Array<any>>,
      this.unsafe.salesMarketVisit.findMany({
        where: this.buildMarketVisitFilter(scope),
        orderBy: [{ visitDate: 'desc' }],
        include: {
          user: { select: { id: true, name: true } },
        },
      }) as Promise<Array<any>>,
    ]);

    const summary = {
      recognizedRevenue: 0,
      newBusinessRevenue: 0,
      renewalRevenue: 0,
      remainingScheduledRevenue: 0,
      creditedCycles: 0,
      activeClients: 0,
      activeHoardings: 0,
      totalEnquiries: inquiries.length,
    };

    const enquiryFunnel = {
      total: inquiries.length,
      won: 0,
      inProcess: 0,
      deadFollowUpLater: 0,
      notInterested: 0,
    };

    const enquirySources = new Map<string, number>();
    const activeClientIds = new Set<string>();
    const activeHoardingIds = new Set<string>();
    const timeline = new Map<string, any>();
    const salespersonBreakdown = new Map<string, any>();
    const enquiriesByDateAndUser = new Map<
      string,
      { total: number; walkIn: number; selfGenerated: number }
    >();

    for (const event of allEvents) {
      const recognitionDate = getRecognitionDate(event);
      const revenue = getNetRevenue(event);
      const isInScope = recognitionDate >= scope.startDate && recognitionDate <= scope.endDate;
      const isFuture =
        recognitionDate > scope.endDate &&
        FUTURE_BILLING_STATUSES.includes(String(event.status || '').toUpperCase());
      const isRecognized = RECOGNIZED_BILLING_STATUSES.includes(
        String(event.status || '').toUpperCase(),
      );
      const salespersonId = String(event.bookingToken?.salesUserId || 'unassigned');
      const salespersonName = String(event.bookingToken?.salesUser?.name || 'Unassigned');
      const salesperson = salespersonBreakdown.get(salespersonId) || {
        salespersonId,
        salespersonName,
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        remainingScheduledRevenue: 0,
        enquiries: 0,
        won: 0,
        inProcess: 0,
        deadFollowUpLater: 0,
        notInterested: 0,
        creditedCycles: 0,
      };

      if (isInScope && isRecognized) {
        const bucketKey = formatBucketKey(recognitionDate, scope.groupBy);
        const bucket = timeline.get(bucketKey) || {
          key: bucketKey,
          recognizedRevenue: 0,
          newBusinessRevenue: 0,
          renewalRevenue: 0,
          enquiries: 0,
          won: 0,
          inProcess: 0,
          deadFollowUpLater: 0,
          notInterested: 0,
          sourceCounts: {},
        };

        bucket.recognizedRevenue += revenue;
        if (event.cycleNumber === 1) {
          bucket.newBusinessRevenue += revenue;
          summary.newBusinessRevenue += revenue;
          salesperson.newBusinessRevenue += revenue;
        } else {
          bucket.renewalRevenue += revenue;
          summary.renewalRevenue += revenue;
          salesperson.renewalRevenue += revenue;
        }

        summary.recognizedRevenue += revenue;
        summary.creditedCycles += 1;
        summary.activeClients += 0;
        activeClientIds.add(String(event.clientId || event.client?.id || ''));
        activeHoardingIds.add(String(event.hoardingId || event.hoarding?.id || ''));
        salesperson.recognizedRevenue += revenue;
        salesperson.creditedCycles += 1;
        timeline.set(bucketKey, bucket);
      }

      if (isFuture) {
        summary.remainingScheduledRevenue += revenue;
        salesperson.remainingScheduledRevenue += revenue;
      }

      salespersonBreakdown.set(salespersonId, salesperson);
    }

    for (const inquiry of inquiries) {
      const sourceKey = String(inquiry.source || 'UNKNOWN');
      enquirySources.set(sourceKey, (enquirySources.get(sourceKey) || 0) + 1);

      const stage = getFunnelStage(inquiry.performanceStage);
      if (stage === 'WON') {
        enquiryFunnel.won += 1;
      } else if (stage === 'NOT_INTERESTED') {
        enquiryFunnel.notInterested += 1;
      } else if (DEAD_FOLLOW_UP_LATER_STAGES.includes(stage)) {
        enquiryFunnel.deadFollowUpLater += 1;
      } else {
        enquiryFunnel.inProcess += 1;
      }

      const bucketKey = formatBucketKey(new Date(inquiry.createdAt), scope.groupBy);
      const bucket = timeline.get(bucketKey) || {
        key: bucketKey,
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        enquiries: 0,
        won: 0,
        inProcess: 0,
        deadFollowUpLater: 0,
        notInterested: 0,
        sourceCounts: {},
      };
      bucket.enquiries += 1;
      bucket.sourceCounts[sourceKey] = (bucket.sourceCounts[sourceKey] || 0) + 1;
      if (stage === 'WON') {
        bucket.won += 1;
      } else if (stage === 'NOT_INTERESTED') {
        bucket.notInterested += 1;
      } else if (DEAD_FOLLOW_UP_LATER_STAGES.includes(stage)) {
        bucket.deadFollowUpLater += 1;
      } else {
        bucket.inProcess += 1;
      }
      timeline.set(bucketKey, bucket);

      const salespersonId = String(inquiry.assignedSalesId || inquiry.createdById || 'unassigned');
      const salespersonName = String(
        inquiry.assignedSales?.name || inquiry.createdBy?.name || 'Unassigned',
      );
      const salesperson = salespersonBreakdown.get(salespersonId) || {
        salespersonId,
        salespersonName,
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        remainingScheduledRevenue: 0,
        enquiries: 0,
        won: 0,
        inProcess: 0,
        deadFollowUpLater: 0,
        notInterested: 0,
        creditedCycles: 0,
      };
      salesperson.enquiries += 1;
      if (stage === 'WON') {
        salesperson.won += 1;
      } else if (stage === 'NOT_INTERESTED') {
        salesperson.notInterested += 1;
      } else if (DEAD_FOLLOW_UP_LATER_STAGES.includes(stage)) {
        salesperson.deadFollowUpLater += 1;
      } else {
        salesperson.inProcess += 1;
      }
      salespersonBreakdown.set(salespersonId, salesperson);

      const enquiryUserId = String(inquiry.createdById || '');
      const visitKey = `${formatBucketKey(new Date(inquiry.createdAt), 'day')}:${enquiryUserId}`;
      const counts = enquiriesByDateAndUser.get(visitKey) || {
        total: 0,
        walkIn: 0,
        selfGenerated: 0,
      };
      counts.total += 1;
      if (sourceKey === 'WALK_IN') counts.walkIn += 1;
      if (sourceKey === 'SELF_GENERATED') counts.selfGenerated += 1;
      enquiriesByDateAndUser.set(visitKey, counts);
    }

    const marketVisitRows = marketVisits.map((row: any) => {
      const dateKey = formatBucketKey(new Date(row.visitDate), 'day');
      const countKey = `${dateKey}:${String(row.userId || '')}`;
      const counts = enquiriesByDateAndUser.get(countKey) || {
        total: 0,
        walkIn: 0,
        selfGenerated: 0,
      };
      return {
        id: String(row.id),
        userId: String(row.userId),
        userName: String(row.user?.name || 'Sales User'),
        visitDate: row.visitDate,
        visitedMarket: Boolean(row.visitedMarket),
        notes: row.notes || null,
        enquiriesCreated: counts.total,
        walkInEnquiries: counts.walkIn,
        selfGeneratedEnquiries: counts.selfGenerated,
      };
    });

    summary.activeClients = activeClientIds.size;
    summary.activeHoardings = activeHoardingIds.size;

    return {
      scope: {
        startDate: scope.startDate,
        endDate: scope.endDate,
        groupBy: scope.groupBy,
        visibility: scope.visibility,
        salespersonId: scope.salespersonId,
      },
      summary,
      enquiryFunnel,
      enquirySources: Array.from(enquirySources.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((left, right) => right.count - left.count),
      timeline: Array.from(timeline.values()).sort((left, right) =>
        left.key.localeCompare(right.key),
      ),
      salespersonBreakdown:
        scope.visibility === 'team'
          ? Array.from(salespersonBreakdown.values()).sort(
              (left, right) => right.recognizedRevenue - left.recognizedRevenue,
            )
          : Array.from(salespersonBreakdown.values()),
      marketVisitRows,
    };
  }

  async getClients(params: {
    startDate?: string;
    endDate?: string;
    salespersonId?: string;
    currentUserId?: string;
    currentRole?: string;
  }) {
    const scope = this.resolveScope(params);
    const salesTokenFilter = this.buildSalesTokenFilter(scope);
    const allEvents = (await prisma.billingEvent.findMany({
      where: salesTokenFilter as any,
      orderBy: [{ dueAt: 'asc' }],
      include: {
        bookingToken: {
          select: {
            id: true,
            salesUserId: true,
            salesUser: { select: { id: true, name: true } },
            durationMonths: true,
            dateFrom: true,
            dateTo: true,
            plannedLiveDate: true,
            finalAgreedBasePrice: true,
            printingChargesBase: true,
            mountingChargesBase: true,
          },
        },
        client: { select: { id: true, name: true } },
        hoarding: {
          select: {
            id: true,
            code: true,
            city: true,
            area: true,
            actualLiveDate: true,
            billingStartDate: true,
            billingStartOverrideDate: true,
          },
        },
      },
    })) as Array<any>;

    const clients = new Map<string, any>();

    for (const event of allEvents) {
      const recognitionDate = getRecognitionDate(event);
      const revenue = getNetRevenue(event);
      const isRecognized =
        recognitionDate <= scope.endDate &&
        RECOGNIZED_BILLING_STATUSES.includes(String(event.status || '').toUpperCase());
      const isCurrentPeriod =
        recognitionDate >= scope.startDate && recognitionDate <= scope.endDate && isRecognized;
      const isFuture =
        recognitionDate > scope.endDate &&
        FUTURE_BILLING_STATUSES.includes(String(event.status || '').toUpperCase());

      if (!isRecognized && !isFuture) {
        continue;
      }

      const clientId = String(event.client?.id || event.clientId || 'unknown-client');
      const hoardingId = String(event.hoarding?.id || event.hoardingId || 'unknown-hoarding');
      const durationMonths = Number(event.bookingToken?.durationMonths || 1) || 1;
      const totalCampaignValue =
        toNumber(event.bookingToken?.finalAgreedBasePrice) * durationMonths +
        toNumber(event.bookingToken?.printingChargesBase) +
        toNumber(event.bookingToken?.mountingChargesBase);
      const anchorDate =
        event.hoarding?.billingStartOverrideDate ||
        event.hoarding?.billingStartDate ||
        event.hoarding?.actualLiveDate ||
        event.bookingToken?.plannedLiveDate ||
        event.bookingToken?.dateFrom ||
        event.billingAnchorDate ||
        null;
      const client = clients.get(clientId) || {
        clientId,
        clientName: String(event.client?.name || 'Unknown Client'),
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        futureScheduledRevenue: 0,
        creditedCycles: 0,
        hoardingsCount: 0,
        nextRecognitionDate: null as Date | null,
        hoardings: new Map<string, any>(),
      };
      const hoarding = client.hoardings.get(hoardingId) || {
        hoardingId,
        code: String(event.hoarding?.code || 'Unknown Hoarding'),
        city: event.hoarding?.city || null,
        area: event.hoarding?.area || null,
        liveDate: anchorDate,
        durationMonths,
        perCycleCreditAmount: revenue,
        totalCampaignValue,
        totalCreditedSoFar: 0,
        remainingAmount: 0,
        currentPeriodCredited: 0,
        futureScheduledRevenue: 0,
        creditedCycles: 0,
        nextCycleDate: null as Date | null,
        nextCycleAmount: 0,
        nextRecognitionDate: null as Date | null,
        salesUserId: String(event.bookingToken?.salesUserId || ''),
        salesUserName: String(event.bookingToken?.salesUser?.name || 'Unassigned'),
        currentCycles: [] as Array<any>,
        schedulePreview: [] as Array<any>,
      };

      hoarding.perCycleCreditAmount = revenue || hoarding.perCycleCreditAmount;

      if (isRecognized) {
        hoarding.totalCreditedSoFar += revenue;
        hoarding.creditedCycles += 1;
        if (isCurrentPeriod) {
          client.recognizedRevenue += revenue;
          client.creditedCycles += 1;
          hoarding.currentPeriodCredited += revenue;
          if (event.cycleNumber === 1) {
            client.newBusinessRevenue += revenue;
          } else {
            client.renewalRevenue += revenue;
          }
          hoarding.currentCycles.push({
            billingEventId: event.id,
            cycleNumber: event.cycleNumber,
            status: event.status,
            recognitionDate,
            revenue,
            revenueType: event.cycleNumber === 1 ? 'new_business' : 'renewal',
          });
        }
      }

      if (isFuture) {
        client.futureScheduledRevenue += revenue;
        hoarding.futureScheduledRevenue += revenue;
        hoarding.remainingAmount += revenue;
        hoarding.schedulePreview.push({
          billingEventId: event.id,
          cycleNumber: event.cycleNumber,
          recognitionDate,
          monthKey: formatPreviewMonth(recognitionDate),
          amount: revenue,
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
        });
        if (!client.nextRecognitionDate || recognitionDate < client.nextRecognitionDate) {
          client.nextRecognitionDate = recognitionDate;
        }
        if (!hoarding.nextRecognitionDate || recognitionDate < hoarding.nextRecognitionDate) {
          hoarding.nextRecognitionDate = recognitionDate;
          hoarding.nextCycleDate = recognitionDate;
          hoarding.nextCycleAmount = revenue;
        }
      }

      client.hoardings.set(hoardingId, hoarding);
      clients.set(clientId, client);
    }

    return {
      scope: {
        startDate: scope.startDate,
        endDate: scope.endDate,
        visibility: scope.visibility,
        salespersonId: scope.salespersonId,
      },
      clients: Array.from(clients.values())
        .map((client) => {
          const hoardings = Array.from(client.hoardings.values())
            .map((hoarding: any) => ({
              ...hoarding,
              schedulePreview: hoarding.schedulePreview.sort(
                (left: any, right: any) =>
                  new Date(left.recognitionDate).getTime() -
                  new Date(right.recognitionDate).getTime(),
              ),
              currentCycles: hoarding.currentCycles.sort(
                (left: any, right: any) => left.cycleNumber - right.cycleNumber,
              ),
            }))
            .sort(
              (left: any, right: any) => right.currentPeriodCredited - left.currentPeriodCredited,
            );
          return {
            clientId: client.clientId,
            clientName: client.clientName,
            recognizedRevenue: client.recognizedRevenue,
            newBusinessRevenue: client.newBusinessRevenue,
            renewalRevenue: client.renewalRevenue,
            futureScheduledRevenue: client.futureScheduledRevenue,
            creditedCycles: client.creditedCycles,
            hoardingsCount: hoardings.length,
            nextRecognitionDate: client.nextRecognitionDate,
            hoardings,
          };
        })
        .sort((left, right) => right.recognizedRevenue - left.recognizedRevenue),
    };
  }

  async listMarketVisits(params: {
    startDate?: string;
    endDate?: string;
    salespersonId?: string;
    currentUserId?: string;
    currentRole?: string;
  }) {
    const scope = this.resolveScope(params);
    const [logs, inquiries] = await Promise.all([
      this.unsafe.salesMarketVisit.findMany({
        where: this.buildMarketVisitFilter(scope),
        orderBy: [{ visitDate: 'desc' }],
        include: { user: { select: { id: true, name: true } } },
      }) as Promise<Array<any>>,
      prisma.inquiry.findMany({
        where: {
          createdAt: { gte: scope.startDate, lte: scope.endDate },
          ...(scope.salespersonId ? { createdById: scope.salespersonId } : {}),
        } as any,
        select: { id: true, source: true, createdAt: true, createdById: true },
      }) as Promise<Array<any>>,
    ]);

    const inquiryCountByUserAndDate = new Map<
      string,
      { total: number; walkIn: number; selfGenerated: number }
    >();
    for (const inquiry of inquiries) {
      const dateKey = formatBucketKey(new Date(inquiry.createdAt), 'day');
      const key = `${String(inquiry.createdById || '')}:${dateKey}`;
      const next = inquiryCountByUserAndDate.get(key) || { total: 0, walkIn: 0, selfGenerated: 0 };
      next.total += 1;
      if (String(inquiry.source || '').toUpperCase() === 'WALK_IN') next.walkIn += 1;
      if (String(inquiry.source || '').toUpperCase() === 'SELF_GENERATED') next.selfGenerated += 1;
      inquiryCountByUserAndDate.set(key, next);
    }

    return {
      scope: {
        startDate: scope.startDate,
        endDate: scope.endDate,
        visibility: scope.visibility,
        salespersonId: scope.salespersonId,
      },
      rows: logs.map((row) => {
        const dateKey = formatBucketKey(new Date(row.visitDate), 'day');
        const counts =
          inquiryCountByUserAndDate.get(`${String(row.userId || '')}:${dateKey}`) ||
          ({ total: 0, walkIn: 0, selfGenerated: 0 } as const);
        return {
          id: String(row.id),
          userId: String(row.userId || ''),
          userName: String(row.user?.name || 'Sales User'),
          visitDate: row.visitDate,
          visitedMarket: Boolean(row.visitedMarket),
          notes: row.notes || null,
          enquiriesCreated: counts.total,
          walkInEnquiries: counts.walkIn,
          selfGeneratedEnquiries: counts.selfGenerated,
        };
      }),
    };
  }

  async upsertMarketVisit(
    payload: { visitDate?: string; visitedMarket?: boolean; notes?: string | null },
    user: { id?: string; role?: { name?: string } },
  ) {
    const userId = String(user?.id || '').trim();
    const roleName = String(user?.role?.name || '')
      .trim()
      .toLowerCase();
    if (!userId) throw new ForbiddenError('Unauthorized');
    if (!['sales', 'sales_head', 'sales head', 'admin', 'owner', 'manager'].includes(roleName)) {
      throw new ForbiddenError('Insufficient permissions');
    }

    const visitDate = payload.visitDate ? new Date(payload.visitDate) : new Date();
    if (Number.isNaN(visitDate.getTime())) {
      throw new BadRequestError('Invalid market visit date');
    }
    const normalizedVisitDate = startOfDay(visitDate);
    const notes = payload.notes != null ? String(payload.notes).trim() || null : null;

    const result = await this.unsafe.salesMarketVisit.upsert({
      where: {
        userId_visitDate: {
          userId,
          visitDate: normalizedVisitDate,
        },
      },
      create: {
        userId,
        visitDate: normalizedVisitDate,
        visitedMarket: payload.visitedMarket !== false,
        notes,
      },
      update: {
        visitedMarket: payload.visitedMarket !== false,
        notes,
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    } as any);

    return result;
  }
}

export default new SalesPerformanceService();
