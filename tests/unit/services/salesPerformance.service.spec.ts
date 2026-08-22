jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    billingEvent: {
      findMany: jest.fn(),
    },
    inquiry: {
      findMany: jest.fn(),
    },
    salesMarketVisit: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { prisma } from '../../../src/lib/prisma';
import { SalesPerformanceService } from '../../../src/services/salesPerformance.service';

const localDate = (year: number, monthIndex: number, day: number) =>
  new Date(year, monthIndex, day);

describe('SalesPerformanceService (unit)', () => {
  let service: SalesPerformanceService;
  const prismaMock = prisma as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalesPerformanceService();
  });

  it('restricts sales users to their own performance scope', async () => {
    await expect(
      service.getOverview({
        currentUserId: 'sales-1',
        currentRole: 'sales',
        salespersonId: 'sales-2',
      }),
    ).rejects.toThrow('You can only view your own sales performance');
  });

  it('aggregates recognized revenue, funnel counts, and market-visit counts correctly', async () => {
    prismaMock.billingEvent.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        status: 'TO_BE_GENERATED',
        cycleNumber: 1,
        dueAt: new Date('2026-05-03T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-05-03T00:00:00.000Z'),
        baseAmount: 10000,
        printingBase: 0,
        mountingBase: 0,
        bookingToken: {
          salesUserId: 'sales-1',
          salesUser: { id: 'sales-1', name: 'Alice' },
        },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme Ads' },
        hoardingId: 'hoarding-1',
        hoarding: { id: 'hoarding-1', code: 'H-001' },
      },
      {
        id: 'evt-2',
        status: 'COMPLETED',
        cycleNumber: 2,
        dueAt: new Date('2026-05-10T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-05-10T00:00:00.000Z'),
        baseAmount: 10000,
        printingBase: 1000,
        mountingBase: 0,
        bookingToken: {
          salesUserId: 'sales-1',
          salesUser: { id: 'sales-1', name: 'Alice' },
        },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme Ads' },
        hoardingId: 'hoarding-2',
        hoarding: { id: 'hoarding-2', code: 'H-002' },
      },
      {
        id: 'evt-3',
        status: 'UPCOMING_SCHEDULED',
        cycleNumber: 3,
        dueAt: new Date('2026-06-03T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-06-03T00:00:00.000Z'),
        baseAmount: 10000,
        printingBase: 1000,
        mountingBase: 0,
        bookingToken: {
          salesUserId: 'sales-1',
          salesUser: { id: 'sales-1', name: 'Alice' },
        },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme Ads' },
        hoardingId: 'hoarding-2',
        hoarding: { id: 'hoarding-2', code: 'H-002' },
      },
    ]);

    prismaMock.inquiry.findMany.mockResolvedValue([
      {
        id: 'inq-1',
        source: 'WALK_IN',
        createdAt: new Date('2026-05-03T10:00:00.000Z'),
        assignedSalesId: 'sales-1',
        createdById: 'sales-1',
        performanceStage: 'WON',
        assignedSales: { id: 'sales-1', name: 'Alice' },
        createdBy: { id: 'sales-1', name: 'Alice' },
      },
      {
        id: 'inq-2',
        source: 'SELF_GENERATED',
        createdAt: new Date('2026-05-03T18:00:00.000Z'),
        assignedSalesId: 'sales-1',
        createdById: 'sales-1',
        performanceStage: 'IN_PROCESS',
        assignedSales: { id: 'sales-1', name: 'Alice' },
        createdBy: { id: 'sales-1', name: 'Alice' },
      },
      {
        id: 'inq-3',
        source: 'WHATSAPP',
        createdAt: new Date('2026-05-10T11:00:00.000Z'),
        assignedSalesId: 'sales-1',
        createdById: 'sales-1',
        performanceStage: 'DEAD',
        assignedSales: { id: 'sales-1', name: 'Alice' },
        createdBy: { id: 'sales-1', name: 'Alice' },
      },
      {
        id: 'inq-4',
        source: 'REFERENCE',
        createdAt: new Date('2026-05-10T14:00:00.000Z'),
        assignedSalesId: 'sales-1',
        createdById: 'sales-1',
        performanceStage: 'NOT_INTERESTED',
        assignedSales: { id: 'sales-1', name: 'Alice' },
        createdBy: { id: 'sales-1', name: 'Alice' },
      },
    ]);

    prismaMock.salesMarketVisit.findMany.mockResolvedValue([
      {
        id: 'visit-1',
        userId: 'sales-1',
        visitDate: new Date('2026-05-03T00:00:00.000Z'),
        visitedMarket: true,
        notes: 'Visited market',
        user: { id: 'sales-1', name: 'Alice' },
      },
    ]);

    const result = await service.getOverview({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      groupBy: 'day',
      currentUserId: 'sales-1',
      currentRole: 'sales',
    });

    expect(result.scope.visibility).toBe('self');
    expect(result.summary.recognizedRevenue).toBe(21000);
    expect(result.summary.newBusinessRevenue).toBe(10000);
    expect(result.summary.renewalRevenue).toBe(11000);
    expect(result.summary.remainingScheduledRevenue).toBe(11000);
    expect(result.summary.totalEnquiries).toBe(4);
    expect(result.summary.activeClients).toBe(1);
    expect(result.summary.activeHoardings).toBe(2);

    expect(result.enquiryFunnel).toEqual({
      total: 4,
      won: 1,
      inProcess: 1,
      deadFollowUpLater: 1,
      notInterested: 1,
    });

    expect(result.marketVisitRows).toHaveLength(1);
    expect(result.marketVisitRows[0]).toMatchObject({
      enquiriesCreated: 2,
      walkInEnquiries: 1,
      selfGeneratedEnquiries: 1,
    });

    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: '2026-05-03',
          recognizedRevenue: 10000,
          enquiries: 2,
          won: 1,
          inProcess: 1,
        }),
        expect.objectContaining({
          key: '2026-05-10',
          recognizedRevenue: 11000,
          enquiries: 2,
          deadFollowUpLater: 1,
          notInterested: 1,
        }),
      ]),
    );
  });

  it('returns client-first drilldown with combined client totals and hoarding-level schedules', async () => {
    prismaMock.billingEvent.findMany.mockResolvedValue([
      {
        id: 'evt-a1',
        status: 'TO_BE_GENERATED',
        cycleNumber: 1,
        dueAt: new Date('2026-05-03T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-05-03T00:00:00.000Z'),
        baseAmount: 10000,
        printingBase: 0,
        mountingBase: 0,
        bookingToken: {
          salesUserId: 'sales-1',
          salesUser: { id: 'sales-1', name: 'Alice' },
          durationMonths: 1,
          finalAgreedBasePrice: 10000,
          printingChargesBase: 0,
          mountingChargesBase: 0,
          plannedLiveDate: new Date('2026-05-03T00:00:00.000Z'),
          dateFrom: new Date('2026-05-03T00:00:00.000Z'),
        },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme Ads' },
        hoardingId: 'hoarding-a',
        hoarding: {
          id: 'hoarding-a',
          code: 'A',
          city: 'Ahmedabad',
          area: 'Navrangpura',
          actualLiveDate: new Date('2026-05-03T00:00:00.000Z'),
          billingStartDate: new Date('2026-05-03T00:00:00.000Z'),
          billingStartOverrideDate: null,
        },
      },
      {
        id: 'evt-b1',
        status: 'TO_BE_GENERATED',
        cycleNumber: 1,
        dueAt: new Date('2026-05-03T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-05-03T00:00:00.000Z'),
        baseAmount: 10000,
        printingBase: 1000,
        mountingBase: 0,
        bookingToken: {
          salesUserId: 'sales-1',
          salesUser: { id: 'sales-1', name: 'Alice' },
          durationMonths: 2,
          finalAgreedBasePrice: 10000,
          printingChargesBase: 2000,
          mountingChargesBase: 0,
          plannedLiveDate: new Date('2026-05-03T00:00:00.000Z'),
          dateFrom: new Date('2026-05-03T00:00:00.000Z'),
        },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme Ads' },
        hoardingId: 'hoarding-b',
        hoarding: {
          id: 'hoarding-b',
          code: 'B',
          city: 'Ahmedabad',
          area: 'CG Road',
          actualLiveDate: new Date('2026-05-03T00:00:00.000Z'),
          billingStartDate: new Date('2026-05-03T00:00:00.000Z'),
          billingStartOverrideDate: null,
        },
      },
      {
        id: 'evt-b2',
        status: 'UPCOMING_SCHEDULED',
        cycleNumber: 2,
        dueAt: new Date('2026-06-03T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-06-03T00:00:00.000Z'),
        baseAmount: 10000,
        printingBase: 1000,
        mountingBase: 0,
        bookingToken: {
          salesUserId: 'sales-1',
          salesUser: { id: 'sales-1', name: 'Alice' },
          durationMonths: 2,
          finalAgreedBasePrice: 10000,
          printingChargesBase: 2000,
          mountingChargesBase: 0,
          plannedLiveDate: new Date('2026-05-03T00:00:00.000Z'),
          dateFrom: new Date('2026-05-03T00:00:00.000Z'),
        },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme Ads' },
        hoardingId: 'hoarding-b',
        hoarding: {
          id: 'hoarding-b',
          code: 'B',
          city: 'Ahmedabad',
          area: 'CG Road',
          actualLiveDate: new Date('2026-05-03T00:00:00.000Z'),
          billingStartDate: new Date('2026-05-03T00:00:00.000Z'),
          billingStartOverrideDate: null,
        },
      },
    ]);

    const result = await service.getClients({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      currentUserId: 'sales-1',
      currentRole: 'sales',
    });

    expect(result.clients).toHaveLength(1);
    expect(result.clients[0]).toMatchObject({
      clientName: 'Acme Ads',
      recognizedRevenue: 21000,
      futureScheduledRevenue: 11000,
      hoardingsCount: 2,
    });

    const hoardingA = result.clients[0].hoardings.find((row: any) => row.code === 'A');
    const hoardingB = result.clients[0].hoardings.find((row: any) => row.code === 'B');

    expect(hoardingA).toMatchObject({
      currentPeriodCredited: 10000,
      remainingAmount: 0,
      totalCampaignValue: 10000,
    });
    expect(hoardingB).toMatchObject({
      currentPeriodCredited: 11000,
      remainingAmount: 11000,
      totalCampaignValue: 22000,
      perCycleCreditAmount: 11000,
      nextCycleAmount: 11000,
    });
    expect(hoardingB.schedulePreview).toHaveLength(1);
    expect(hoardingB.schedulePreview[0]).toMatchObject({
      amount: 11000,
      monthKey: '2026-06',
    });
  });

  it('allows sales market-visit upsert for sales users and rejects unauthorized roles', async () => {
    prismaMock.salesMarketVisit.upsert.mockResolvedValue({
      id: 'visit-1',
      userId: 'sales-1',
      visitDate: new Date('2026-05-03T00:00:00.000Z'),
      visitedMarket: true,
      notes: 'Checked market',
      user: { id: 'sales-1', name: 'Alice' },
    });

    const saved = await service.upsertMarketVisit(
      {
        visitDate: '2026-05-03',
        visitedMarket: true,
        notes: 'Checked market',
      },
      { id: 'sales-1', role: { name: 'sales' } },
    );

    expect(saved).toMatchObject({
      id: 'visit-1',
      userId: 'sales-1',
      visitedMarket: true,
    });
    expect(prismaMock.salesMarketVisit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_visitDate: {
            userId: 'sales-1',
            visitDate: localDate(2026, 4, 3),
          },
        },
      }),
    );

    await expect(
      service.upsertMarketVisit(
        { visitDate: '2026-05-03', visitedMarket: true },
        { id: 'accountant-1', role: { name: 'accountant' } },
      ),
    ).rejects.toThrow('Insufficient permissions');
  });
});
