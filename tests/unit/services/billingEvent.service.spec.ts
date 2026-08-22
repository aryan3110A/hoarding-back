const notifyUsersIdempotent = jest.fn();
const findByRoles = jest.fn();

jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    billingEvent: {
      findMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    bookingToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    hoarding: {
      findUnique: jest.fn(),
    },
    invoice: {
      aggregate: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../../src/services/notification.service', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({
    notifyUsersIdempotent,
  })),
}));

jest.mock('../../../src/repositories/user.repository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    findByRoles,
  })),
}));

import { prisma } from '../../../src/lib/prisma';
import { BillingEventService } from '../../../src/services/billingEvent.service';

const localDate = (year: number, monthIndex: number, day: number) =>
  new Date(year, monthIndex, day);

describe('BillingEventService (unit)', () => {
  let service: BillingEventService;
  const prismaMock = prisma as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingEventService();
    findByRoles.mockImplementation(async (roles: string[]) => {
      if ((roles || []).includes('accountant')) return [{ id: 'acc-1' }];
      if ((roles || []).includes('sales_head') || (roles || []).includes('sales head')) {
        return [{ id: 'head-1' }];
      }
      return [];
    });
  });

  it('credits live cycles automatically and notifies accountant plus sales recipients', async () => {
    prismaMock.billingEvent.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        status: 'UPCOMING_SCHEDULED',
        cycleNumber: 1,
        dueAt: new Date('2026-05-01T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-05-01T00:00:00.000Z'),
        periodStart: new Date('2026-05-01T00:00:00.000Z'),
        periodEnd: new Date('2026-05-31T00:00:00.000Z'),
        notificationSentAt: null,
        baseAmount: 10000,
        printingBase: 1000,
        mountingBase: 0,
        client: { name: 'Acme Ads' },
        bookingToken: { salesUserId: 'sales-1' },
        hoarding: {
          code: 'H-001',
          status: 'live',
          actualLiveDate: new Date('2026-05-01T00:00:00.000Z'),
          billingStartDate: new Date('2026-05-01T00:00:00.000Z'),
        },
      },
    ]);
    prismaMock.billingEvent.update.mockResolvedValue({});

    await service.syncQueueStatuses();

    expect(prismaMock.billingEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-1' },
        data: expect.objectContaining({ status: 'TO_BE_GENERATED' }),
      }),
    );

    expect(notifyUsersIdempotent).toHaveBeenCalledWith(
      ['acc-1'],
      'Bill ready to generate',
      expect.stringContaining('Acme Ads - H-001 cycle 1 is ready for billing.'),
      '/dashboard/accountant',
      'billing_due:evt-1',
    );

    expect(notifyUsersIdempotent).toHaveBeenCalledWith(
      expect.arrayContaining(['sales-1', 'head-1']),
      'Cycle credited',
      expect.stringContaining('Amount Rs 11000.00'),
      '/reports',
      'cycle_credited:evt-1',
    );
  });

  it('blocks non-live cycles and notifies sales recipients without generating billing', async () => {
    prismaMock.billingEvent.findMany.mockResolvedValue([
      {
        id: 'evt-2',
        status: 'UPCOMING_SCHEDULED',
        cycleNumber: 1,
        dueAt: new Date('2026-05-01T00:00:00.000Z'),
        liveEligibleAt: new Date('2026-05-01T00:00:00.000Z'),
        periodStart: new Date('2026-05-01T00:00:00.000Z'),
        periodEnd: new Date('2026-05-31T00:00:00.000Z'),
        client: { name: 'Acme Ads' },
        bookingToken: { salesUserId: 'sales-1' },
        hoarding: {
          code: 'H-002',
          status: 'available',
          actualLiveDate: null,
          billingStartDate: null,
        },
      },
    ]);

    await service.syncQueueStatuses();

    expect(prismaMock.billingEvent.update).not.toHaveBeenCalled();
    expect(notifyUsersIdempotent).toHaveBeenCalledWith(
      expect.arrayContaining(['sales-1', 'head-1']),
      'Cycle not credited',
      expect.stringContaining('H-002'),
      '/reports',
      'cycle_not_credited:evt-2',
    );
  });

  it('generates cycle events from the live-date anchor and distributes printing per cycle', async () => {
    prismaMock.bookingToken.findUnique.mockResolvedValue({
      id: 'token-1',
      hoardingId: 'hoarding-1',
      clientId: 'client-1',
      paymentPlanType: 'POST_MONTHLY',
      billingFrequency: 'MONTHLY',
      finalAgreedBasePrice: 10000,
      printingChargesBase: 2000,
      mountingChargesBase: 0,
      gstApplicable: false,
      durationMonths: 2,
      dateFrom: new Date('2026-05-03T00:00:00.000Z'),
      dateTo: new Date('2026-07-02T00:00:00.000Z'),
      plannedLiveDate: new Date('2026-05-03T00:00:00.000Z'),
      modeOfPayment: 'UPI',
      client: { id: 'client-1', name: 'Acme Ads' },
      hoarding: {
        id: 'hoarding-1',
        actualLiveDate: new Date('2026-05-03T00:00:00.000Z'),
        billingStartDate: new Date('2026-05-03T00:00:00.000Z'),
        billingStartOverrideDate: null,
      },
    });
    prismaMock.billingEvent.findFirst.mockResolvedValue(null);
    prismaMock.billingEvent.upsert.mockResolvedValue({});
    prismaMock.billingEvent.deleteMany.mockResolvedValue({ count: 0 });
    jest.spyOn(service, 'syncQueueStatuses').mockResolvedValue(undefined as never);

    const result = await service.syncForToken('token-1');

    expect(result).toEqual({ synced: 2 });
    expect(prismaMock.billingEvent.upsert).toHaveBeenCalledTimes(2);

    const firstCall = prismaMock.billingEvent.upsert.mock.calls[0][0];
    const secondCall = prismaMock.billingEvent.upsert.mock.calls[1][0];

    expect(Number(firstCall.create.baseAmount)).toBe(10000);
    expect(Number(firstCall.create.printingBase)).toBe(1000);
    expect(Number(firstCall.create.mountingBase)).toBe(0);
    expect(Number(firstCall.create.totalAmount)).toBe(11000);
    expect(firstCall.create.status).toBe('TO_BE_GENERATED');
    expect(firstCall.create.periodStart).toEqual(localDate(2026, 4, 3));
    expect(firstCall.create.periodEnd).toEqual(localDate(2026, 5, 2));

    expect(Number(secondCall.create.baseAmount)).toBe(10000);
    expect(Number(secondCall.create.printingBase)).toBe(1000);
    expect(Number(secondCall.create.totalAmount)).toBe(11000);
    expect(secondCall.create.status).toBe('UPCOMING_SCHEDULED');
    expect(secondCall.create.periodStart).toEqual(localDate(2026, 5, 3));
    expect(secondCall.create.periodEnd).toEqual(localDate(2026, 6, 2));
    expect(secondCall.create.dueAt).toEqual(localDate(2026, 5, 2));
  });
});
