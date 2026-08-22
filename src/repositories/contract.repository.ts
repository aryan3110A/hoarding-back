import { prisma } from '../lib/prisma';

export class ContractRepository {
  private get unsafe() {
    return prisma as unknown as {
      contract: {
        findMany: (args?: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<unknown>;
      };
    };
  }

  async findPendingByHoarding(hoardingId: string) {
    return this.unsafe.contract.findMany({
      where: {
        hoardingId,
        status: 'PENDING_ACTIVATION',
        startDate: null,
      },
    }) as Promise<any>;
  }

  async activateMany(ids: string[], data: Record<string, unknown>) {
    return this.unsafe.contract.updateMany({
      where: { id: { in: ids } },
      data,
    }) as Promise<any>;
  }

  async listAll() {
    return this.unsafe.contract.findMany({ orderBy: { createdAt: 'desc' } }) as Promise<any>;
  }

  async findActiveExpiringWithinDays(days: number) {
    const now = new Date();
    const upTo = new Date();
    upTo.setDate(now.getDate() + days);
    return this.unsafe.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lte: upTo, gte: now },
      },
    }) as Promise<any>;
  }

  async findActivePastDueWithoutRenewal() {
    const now = new Date();
    return this.unsafe.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: now },
        renewals: { none: {} },
      },
    }) as Promise<any>;
  }

  async markStatus(ids: string[], status: string) {
    return this.unsafe.contract.updateMany({
      where: { id: { in: ids } },
      data: { status },
    }) as Promise<any>;
  }
}
