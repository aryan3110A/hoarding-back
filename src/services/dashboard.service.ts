import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ForbiddenError } from '../lib/errors';
import { PropertyRentRepository } from '../repositories/propertyRent.repository';
import { PropertyRentService } from './propertyRent.service';
import SalesPerformanceService from './salesPerformance.service';

const propertyRentRepository = new PropertyRentRepository();
const propertyRentService = new PropertyRentService();
const MANAGEMENT_ROLES = new Set(['admin', 'owner', 'manager']);
const RECOGNIZED_BILLING_STATUSES = ['TO_BE_GENERATED', 'PO_PENDING', 'OVERDUE', 'COMPLETED'];

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

const getSalesSummaryCards = async () => {
  const now = new Date();
  const startToday = startOfDay(now);
  const endToday = endOfDay(now);

  const startWeek = startOfDay(now);
  const day = startWeek.getDay();
  const diffToMon = day === 0 ? 6 : day - 1;
  startWeek.setDate(startWeek.getDate() - diffToMon);

  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [today, week, month] = await Promise.all([
    SalesPerformanceService.getOverview({
      startDate: toIsoDate(startToday),
      endDate: toIsoDate(endToday),
      currentUserId: 'dashboard',
      currentRole: 'owner',
      groupBy: 'day',
    }),
    SalesPerformanceService.getOverview({
      startDate: toIsoDate(startWeek),
      endDate: toIsoDate(endToday),
      currentUserId: 'dashboard',
      currentRole: 'owner',
      groupBy: 'day',
    }),
    SalesPerformanceService.getOverview({
      startDate: toIsoDate(monthStart),
      endDate: toIsoDate(monthEnd),
      currentUserId: 'dashboard',
      currentRole: 'owner',
      groupBy: 'day',
    }),
  ]);

  return {
    totalSaleToday: Number(today?.summary?.recognizedRevenue || 0),
    totalSaleThisWeek: Number(week?.summary?.recognizedRevenue || 0),
    totalSaleThisMonth: Number(month?.summary?.recognizedRevenue || 0),
  };
};

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

const formatBucketKey = (value: Date, groupBy: 'day' | 'month') => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  if (groupBy === 'month') return `${year}-${month}`;
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRecognitionDate = (row: { liveEligibleAt?: Date | null; dueAt: Date }) =>
  row.liveEligibleAt || row.dueAt;

const getNetRevenue = (row: {
  baseAmount?: Prisma.Decimal | number | string | null;
  printingBase?: Prisma.Decimal | number | string | null;
  mountingBase?: Prisma.Decimal | number | string | null;
}) => toNumber(row.baseAmount) + toNumber(row.printingBase) + toNumber(row.mountingBase);

type SalesPerformanceScope = {
  startDate: Date;
  endDate: Date;
  groupBy: 'day' | 'month';
  visibility: 'self' | 'team';
  salespersonId: string | null;
};

export class DashboardService {
  private resolveSalesPerformanceScope(params: {
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
      throw new ForbiddenError('Invalid sales performance date range');
    }

    if (startDate.getTime() > endDate.getTime()) {
      throw new ForbiddenError('Start date cannot be after end date');
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

    const visibility: 'self' | 'team' = isManagement ? 'team' : 'self';
    const salespersonId = isManagement ? requestedSalespersonId : params.currentUserId || null;
    const daySpan = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const requestedGroupBy = String(params.groupBy || '')
      .trim()
      .toLowerCase();
    const groupBy: 'day' | 'month' =
      requestedGroupBy === 'day' || requestedGroupBy === 'month'
        ? (requestedGroupBy as 'day' | 'month')
        : daySpan > 45
          ? 'month'
          : 'day';

    return {
      startDate,
      endDate,
      groupBy,
      visibility,
      salespersonId,
    };
  }

  private buildRevenueDateWhere(scope: SalesPerformanceScope) {
    return {
      OR: [
        { liveEligibleAt: { gte: scope.startDate, lte: scope.endDate } },
        { liveEligibleAt: null, dueAt: { gte: scope.startDate, lte: scope.endDate } },
      ],
    };
  }

  private buildFutureRevenueDateWhere(scope: SalesPerformanceScope) {
    return {
      OR: [
        { liveEligibleAt: { gt: scope.endDate } },
        { liveEligibleAt: null, dueAt: { gt: scope.endDate } },
      ],
    };
  }

  private buildInquiryWhere(scope: SalesPerformanceScope) {
    if (!scope.salespersonId) {
      return { createdAt: { gte: scope.startDate, lte: scope.endDate } };
    }

    return {
      createdAt: { gte: scope.startDate, lte: scope.endDate },
      OR: [{ assignedSalesId: scope.salespersonId }, { createdById: scope.salespersonId }],
    };
  }

  async getOwnerDashboardStats() {
    // Prefer property-level rent model; fallback to legacy hoarding-level rent
    const propertyRents = await propertyRentRepository.list();
    if (propertyRents.rows.length) {
      const rows = propertyRents.rows as Array<any>;
      const dedupe = new Map<string, any>();
      for (const row of rows) {
        const landlord = String(row.landlord || '')
          .trim()
          .toLowerCase();
        const key = landlord || `group:${String(row.propertyGroupId || '')}`;
        if (!dedupe.has(key)) dedupe.set(key, row);
      }
      const all = Array.from(dedupe.values());

      console.log(
        'DashboardService: Calculating stats with grouping logic. Total rents found:',
        all.length,
      );

      const totalProperties = all.length;

      // Financials still based on property-level rents
      let annualized = 0;
      for (const r of all) {
        const amount = Number(r.rentAmount);
        switch (r.paymentFrequency) {
          case 'Monthly':
            annualized += amount * 12;
            break;
          case 'Quarterly':
            annualized += amount * 4;
            break;
          case 'HalfYearly':
            annualized += amount * 2;
            break;
          case 'Yearly':
            annualized += amount;
            break;
          default:
            annualized += amount;
        }
      }
      const monthlyLoad = annualized / 12;
      const [upcomingDues, overdue, rentPaymentTotals, salesSummary] = await Promise.all([
        propertyRentService.upcoming(14),
        propertyRentService.overdue(),
        propertyRentService.paymentTotals(),
        getSalesSummaryCards(),
      ]);

      type SalesInquiryGroup = { assignedSalesId: string | null; _count: { _all: number } };
      type SalesUserLite = { id: string; name: string | null };
      const salesWiseInquiryGroups = (await prisma.inquiry.groupBy({
        by: ['assignedSalesId'],
        _count: { _all: true },
      })) as SalesInquiryGroup[];
      const salesIds = salesWiseInquiryGroups
        .map((g: SalesInquiryGroup) => String(g.assignedSalesId || ''))
        .filter(Boolean);
      const salesUsers: SalesUserLite[] = salesIds.length
        ? await prisma.user.findMany({
            where: { id: { in: salesIds } },
            select: { id: true, name: true },
          })
        : [];
      const salesNameById = new Map(
        salesUsers.map((u: SalesUserLite) => [String(u.id), String(u.name || '')]),
      );
      const salesWiseInquiries = salesWiseInquiryGroups.map((g: SalesInquiryGroup) => ({
        salesUserId: g.assignedSalesId,
        salesUserName: g.assignedSalesId
          ? salesNameById.get(String(g.assignedSalesId)) || 'Unknown'
          : 'Unassigned',
        count: g._count?._all || 0,
      }));

      return {
        mode: 'property',
        totalProperties,
        totalMonthlyRentLoad: monthlyLoad,
        totalAnnualizedRent: annualized,
        upcomingDues,
        overduePayments: overdue,
        salesWiseInquiries,
        rentPaymentTotals,
        salesSummary,
      };
    }

    // Legacy fallback
    const totalHoardingsOnRent = await prisma.rent.count();
    const rentSum = await prisma.rent.aggregate({ _sum: { rentAmount: true } });
    const allRents = await prisma.rent.findMany({
      select: { rentAmount: true, paymentMode: true },
    });
    let totalAnnualizedRent = 0;
    for (const r of allRents) {
      const amount = Number(r.rentAmount);
      switch (r.paymentMode) {
        case 'Monthly':
          totalAnnualizedRent += amount * 12;
          break;
        case 'Quarterly':
          totalAnnualizedRent += amount * 4;
          break;
        case 'Half-Yearly':
          totalAnnualizedRent += amount * 2;
          break;
        case 'Yearly':
          totalAnnualizedRent += amount;
          break;
        default:
          totalAnnualizedRent += amount;
      }
    }
    const totalMonthlyRent = totalAnnualizedRent / 12;
    const upcomingDues = await prisma.rent.findMany({
      where: { nextDueDate: { gte: new Date() } },
      take: 5,
      orderBy: { nextDueDate: 'asc' },
      include: {
        hoarding: { select: { code: true, title: true, city: true, area: true } },
      },
    });
    return {
      mode: 'legacy-hoarding',
      totalHoardingsOnRent,
      totalRentAmount: totalMonthlyRent,
      totalAnnualizedRent,
      upcomingDues,
    };
  }

  async getExpiringContracts() {
    // Return contracts flagged as EXPIRING_SOON ordered by endDate
    const rows = await prisma.contract.findMany({
      where: { status: 'EXPIRING_SOON' },
      orderBy: { endDate: 'asc' },
      select: {
        id: true,
        contractNumber: true,
        clientId: true,
        hoardingId: true,
        clientName: true,
        hoardingCode: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });
    return rows;
  }

  async getManagerDashboardStats() {
    // Manager: use landlord/property-level rents only (no per-hoarding multiplication)
    const propertyRents = await propertyRentRepository.list();
    const rows = propertyRents.rows as Array<any>;
    const dedupe = new Map<string, any>();
    for (const row of rows) {
      const landlord = String(row.landlord || '')
        .trim()
        .toLowerCase();
      const key = landlord || `group:${String(row.propertyGroupId || '')}`;
      if (!dedupe.has(key)) dedupe.set(key, row);
    }
    const all = Array.from(dedupe.values());

    let annualized = 0;
    for (const r of all) {
      const amount = Number(r.rentAmount || 0);
      switch (r.paymentFrequency) {
        case 'Monthly':
          annualized += amount * 12;
          break;
        case 'Quarterly':
          annualized += amount * 4;
          break;
        case 'HalfYearly':
          annualized += amount * 2;
          break;
        case 'Yearly':
          annualized += amount;
          break;
        default:
          annualized += amount;
      }
    }

    const totalHoardingsOnRent = all.length;
    const totalRentAmount = annualized / 12;
    const upcomingDues = await propertyRentRepository.upcomingDues(14);
    type SalesInquiryGroup = { assignedSalesId: string | null; _count: { _all: number } };
    type SalesUserLite = { id: string; name: string | null };
    const salesWiseInquiryGroups = (await prisma.inquiry.groupBy({
      by: ['assignedSalesId'],
      _count: { _all: true },
    })) as SalesInquiryGroup[];
    const salesIds = salesWiseInquiryGroups
      .map((g: SalesInquiryGroup) => String(g.assignedSalesId || ''))
      .filter(Boolean);
    const salesUsers: SalesUserLite[] = salesIds.length
      ? await prisma.user.findMany({
          where: { id: { in: salesIds } },
          select: { id: true, name: true },
        })
      : [];
    const salesNameById = new Map(
      salesUsers.map((u: SalesUserLite) => [String(u.id), String(u.name || '')]),
    );
    const salesWiseInquiries = salesWiseInquiryGroups.map((g: SalesInquiryGroup) => ({
      salesUserId: g.assignedSalesId,
      salesUserName: g.assignedSalesId
        ? salesNameById.get(String(g.assignedSalesId)) || 'Unknown'
        : 'Unassigned',
      count: g._count?._all || 0,
    }));

    return {
      mode: 'property',
      totalHoardingsOnRent,
      totalRentAmount,
      upcomingDues,
      salesWiseInquiries,
    };
  }

  async getSalesDashboardStats(userId?: string) {
    // Sales: very basic metrics – available hoardings count + own bookings count
    const availableHoardings = await prisma.hoarding.count({ where: { status: 'available' } });
    let myBookings = 0;
    let myEnquiries = 0;
    if (userId) {
      myBookings = await prisma.booking.count({ where: { createdBy: userId } });
      myEnquiries = await prisma.inquiry.count({ where: { assignedSalesId: userId } });
    }
    return { availableHoardings, myBookings, myEnquiries };
  }

  async getSalesPerformanceOverview(params: {
    startDate?: string;
    endDate?: string;
    groupBy?: string;
    salespersonId?: string;
    currentUserId?: string;
    currentRole?: string;
  }) {
    const scope = this.resolveSalesPerformanceScope(params);
    const eventWhere = {
      status: { in: RECOGNIZED_BILLING_STATUSES },
      ...(scope.salespersonId ? { bookingToken: { salesUserId: scope.salespersonId } } : {}),
      ...this.buildRevenueDateWhere(scope),
    } as Record<string, unknown>;

    const [events, inquiries, contractsDue] = await Promise.all([
      prisma.billingEvent.findMany({
        where: eventWhere as any,
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
        where: this.buildInquiryWhere(scope) as any,
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          source: true,
          status: true,
          performanceStage: true,
          createdAt: true,
          assignedSalesId: true,
          createdById: true,
          assignedSales: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }) as Promise<Array<any>>,
      prisma.contract.findMany({
        where: {
          endDate: {
            gte: scope.startDate ? new Date(scope.startDate) : undefined,
            lte: scope.endDate ? new Date(scope.endDate) : undefined,
          },
          ...(scope.salespersonId ? { createdById: scope.salespersonId } : {}),
        },
        select: {
          id: true,
          renewals: {
            select: { id: true }
          }
        }
      }) as Promise<Array<any>>,
    ]);

    const totalEnquiries = inquiries.length;
    const wonInquiries = inquiries.filter(i => i.performanceStage === 'WON').length;
    const deadInquiries = inquiries.filter(i => ['DEAD', 'NOT_INTERESTED'].includes(i.performanceStage)).length;
    const inProcessInquiries = inquiries.filter(i => i.performanceStage === 'IN_PROCESS').length;

    const dealConversionPct = totalEnquiries > 0 ? Number(((wonInquiries / totalEnquiries) * 100).toFixed(2)) : 0;
    const deadConversionPct = totalEnquiries > 0 ? Number(((deadInquiries / totalEnquiries) * 100).toFixed(2)) : 0;
    const inProcessConversionPct = totalEnquiries > 0 ? Number(((inProcessInquiries / totalEnquiries) * 100).toFixed(2)) : 0;

    const totalContractsDue = contractsDue.length;
    const renewedContractsCount = contractsDue.filter(c => c.renewals && c.renewals.length > 0).length;
    const renewalConversionPct = totalContractsDue > 0 ? Number(((renewedContractsCount / totalContractsDue) * 100).toFixed(2)) : 0;

    const summary = {
      recognizedRevenue: 0,
      newBusinessRevenue: 0,
      renewalRevenue: 0,
      creditedCycles: 0,
      activeClients: 0,
      activeHoardings: 0,
      totalEnquiries: totalEnquiries,
      dealConversionPct,
      deadConversionPct,
      inProcessConversionPct,
      renewalConversionPct,
      totalContractsDue,
      renewedContractsCount,
    };

    const enquirySources = new Map<string, number>();
    const activeClientIds = new Set<string>();
    const activeHoardingIds = new Set<string>();
    const timeline = new Map<
      string,
      {
        key: string;
        recognizedRevenue: number;
        newBusinessRevenue: number;
        renewalRevenue: number;
        enquiries: number;
      }
    >();
    const salespersonBreakdown = new Map<
      string,
      {
        salespersonId: string;
        salespersonName: string;
        recognizedRevenue: number;
        newBusinessRevenue: number;
        renewalRevenue: number;
        enquiries: number;
        creditedCycles: number;
      }
    >();

    for (const event of events) {
      const recognizedAt = getRecognitionDate(event);
      const revenue = getNetRevenue(event);
      const bucketKey = formatBucketKey(recognizedAt, scope.groupBy);
      const bucket = timeline.get(bucketKey) || {
        key: bucketKey,
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        enquiries: 0,
      };

      bucket.recognizedRevenue += revenue;
      if (event.cycleNumber === 1) {
        bucket.newBusinessRevenue += revenue;
        summary.newBusinessRevenue += revenue;
      } else {
        bucket.renewalRevenue += revenue;
        summary.renewalRevenue += revenue;
      }
      timeline.set(bucketKey, bucket);

      summary.recognizedRevenue += revenue;
      summary.creditedCycles += 1;
      if (event.clientId) activeClientIds.add(String(event.clientId));
      if (event.hoardingId) activeHoardingIds.add(String(event.hoardingId));

      const salespersonId = String(event.bookingToken?.salesUserId || 'unassigned');
      const salespersonName = String(event.bookingToken?.salesUser?.name || 'Unassigned');
      const salesperson = salespersonBreakdown.get(salespersonId) || {
        salespersonId,
        salespersonName,
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        enquiries: 0,
        creditedCycles: 0,
      };
      salesperson.recognizedRevenue += revenue;
      salesperson.creditedCycles += 1;
      if (event.cycleNumber === 1) {
        salesperson.newBusinessRevenue += revenue;
      } else {
        salesperson.renewalRevenue += revenue;
      }
      salespersonBreakdown.set(salespersonId, salesperson);
    }

    for (const inquiry of inquiries) {
      const sourceKey = String(inquiry.source || 'UNKNOWN');
      enquirySources.set(sourceKey, (enquirySources.get(sourceKey) || 0) + 1);

      const bucketKey = formatBucketKey(new Date(inquiry.createdAt), scope.groupBy);
      const bucket = timeline.get(bucketKey) || {
        key: bucketKey,
        recognizedRevenue: 0,
        newBusinessRevenue: 0,
        renewalRevenue: 0,
        enquiries: 0,
      };
      bucket.enquiries += 1;
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
        enquiries: 0,
        creditedCycles: 0,
      };
      salesperson.enquiries += 1;
      salespersonBreakdown.set(salespersonId, salesperson);
    }

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
    };
  }

  async getSalesPerformanceClients(params: {
    startDate?: string;
    endDate?: string;
    salespersonId?: string;
    currentUserId?: string;
    currentRole?: string;
  }) {
    const scope = this.resolveSalesPerformanceScope(params);
    const currentEventsWhere = {
      status: { in: RECOGNIZED_BILLING_STATUSES },
      ...(scope.salespersonId ? { bookingToken: { salesUserId: scope.salespersonId } } : {}),
      ...this.buildRevenueDateWhere(scope),
    } as Record<string, unknown>;
    const futureEventsWhere = {
      ...(scope.salespersonId ? { bookingToken: { salesUserId: scope.salespersonId } } : {}),
      ...this.buildFutureRevenueDateWhere(scope),
    } as Record<string, unknown>;

    const [currentEvents, futureEvents] = await Promise.all([
      prisma.billingEvent.findMany({
        where: currentEventsWhere as any,
        orderBy: [{ dueAt: 'asc' }],
        include: {
          bookingToken: {
            select: {
              salesUserId: true,
              salesUser: { select: { id: true, name: true } },
            },
          },
          client: { select: { id: true, name: true } },
          hoarding: { select: { id: true, code: true, city: true, area: true } },
        },
      }) as Promise<Array<any>>,
      prisma.billingEvent.findMany({
        where: futureEventsWhere as any,
        orderBy: [{ dueAt: 'asc' }],
        include: {
          bookingToken: {
            select: {
              salesUserId: true,
              salesUser: { select: { id: true, name: true } },
            },
          },
          client: { select: { id: true, name: true } },
          hoarding: { select: { id: true, code: true, city: true, area: true } },
        },
      }) as Promise<Array<any>>,
    ]);

    const clients = new Map<string, any>();

    for (const event of currentEvents) {
      const clientId = String(event.client?.id || event.clientId || 'unknown-client');
      const hoardingId = String(event.hoarding?.id || event.hoardingId || 'unknown-hoarding');
      const recognizedAt = getRecognitionDate(event);
      const revenue = getNetRevenue(event);
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
        recognizedRevenue: 0,
        futureScheduledRevenue: 0,
        creditedCycles: 0,
        nextRecognitionDate: null as Date | null,
        salesUserId: String(event.bookingToken?.salesUserId || ''),
        salesUserName: String(event.bookingToken?.salesUser?.name || 'Unassigned'),
        cycles: [] as Array<any>,
      };

      client.recognizedRevenue += revenue;
      client.creditedCycles += 1;
      hoarding.recognizedRevenue += revenue;
      hoarding.creditedCycles += 1;
      if (event.cycleNumber === 1) {
        client.newBusinessRevenue += revenue;
      } else {
        client.renewalRevenue += revenue;
      }

      hoarding.cycles.push({
        billingEventId: event.id,
        cycleNumber: event.cycleNumber,
        status: event.status,
        recognitionDate: recognizedAt,
        revenue,
        revenueType: event.cycleNumber === 1 ? 'new_business' : 'renewal',
      });

      client.hoardings.set(hoardingId, hoarding);
      clients.set(clientId, client);
    }

    for (const event of futureEvents) {
      const clientId = String(event.client?.id || event.clientId || 'unknown-client');
      const hoardingId = String(event.hoarding?.id || event.hoardingId || 'unknown-hoarding');
      const revenue = getNetRevenue(event);
      const recognitionDate = getRecognitionDate(event);
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
        recognizedRevenue: 0,
        futureScheduledRevenue: 0,
        creditedCycles: 0,
        nextRecognitionDate: null as Date | null,
        salesUserId: String(event.bookingToken?.salesUserId || ''),
        salesUserName: String(event.bookingToken?.salesUser?.name || 'Unassigned'),
        cycles: [] as Array<any>,
      };

      client.futureScheduledRevenue += revenue;
      hoarding.futureScheduledRevenue += revenue;
      if (!client.nextRecognitionDate || recognitionDate < client.nextRecognitionDate) {
        client.nextRecognitionDate = recognitionDate;
      }
      if (!hoarding.nextRecognitionDate || recognitionDate < hoarding.nextRecognitionDate) {
        hoarding.nextRecognitionDate = recognitionDate;
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
          const hoardings = Array.from(client.hoardings.values()).sort(
            (left: any, right: any) => right.recognizedRevenue - left.recognizedRevenue,
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

  async getDesignerDashboardStats(userId?: string) {
    // Placeholder: design assignments feature not implemented yet; return stub metrics
    return { assignmentsTotal: 0, assignmentsInProgress: 0, userId };
  }

  async getFitterDashboardStats(userId?: string) {
    // Placeholder: fitter jobs/tasks not implemented; return stub metrics
    return { jobsAssigned: 0, jobsCompleted: 0, userId };
  }
}
