import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { ContractRepository } from '../repositories/contract.repository';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';
import { eventBus } from '../lib/eventBus';
import { NotFoundError, BadRequestError, ForbiddenError } from '../lib/errors';

type RenewalTokenRecord = {
  id: string;
  hoardingId: string;
  clientId: string;
  salesUserId: string;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
  createdAt?: Date | string | null;
  status?: string | null;
  client?: RenewalClientLite | null;
  hoarding?: RenewalHoardingLite | null;
};

type RenewalClientLite = { id: string; name?: string | null; phone?: string | null };
type RenewalHoardingLite = {
  id: string;
  code?: string | null;
  status?: string | null;
  city?: string | null;
  area?: string | null;
  landmark?: string | null;
  roadName?: string | null;
};
type RenewalUserLite = { id: string; name?: string | null };

export class ContractService {
  private repo: ContractRepository;
  private notification: NotificationService;
  private userRepo: UserRepository;

  constructor() {
    this.repo = new ContractRepository();
    this.notification = new NotificationService();
    this.userRepo = new UserRepository();
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  status?: string | null;
  private endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  private daysBetween(from: Date, to: Date): number {
    const start = this.startOfDay(from).getTime();
    const end = this.startOfDay(to).getTime();
    return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  }

  private isPastExpiryEnd(dateValue?: Date | string | null): boolean {
    if (!dateValue) return false;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    return Date.now() > this.endOfDay(d).getTime();
  }

  async reconcileExpiredLiveHoardings(input?: { hoardingId?: string }) {
    const where: Prisma.HoardingWhereInput = {
      status: { equals: 'live', mode: 'insensitive' },
      ...(input?.hoardingId ? { id: input.hoardingId } : {}),
    };

    const liveRows: Array<{ id: string; code: string | null; expiryDate: Date | null }> =
      await prisma.hoarding.findMany({
        where,
        select: { id: true, code: true, expiryDate: true },
      });

    if (!liveRows.length) {
      return { checked: 0, updated: 0 };
    }

    const hoardingIds = liveRows.map((row) => row.id);
    const latestTokens: Array<{ hoardingId: string; dateTo: Date | null }> =
      await prisma.bookingToken.findMany({
        where: {
          hoardingId: { in: hoardingIds },
          status: { notIn: ['CANCELLED', 'RELEASED'] },
        },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          hoardingId: true,
          dateTo: true,
        },
      });

    const latestTokenByHoarding = new Map<string, Date | null>();
    for (const token of latestTokens) {
      const hid = String(token.hoardingId || '');
      if (!hid || latestTokenByHoarding.has(hid)) continue;
      latestTokenByHoarding.set(hid, token.dateTo || null);
    }

    const expiredIds = liveRows
      .filter((row) => {
        const effectiveExpiry = row.expiryDate || latestTokenByHoarding.get(row.id) || null;
        return this.isPastExpiryEnd(effectiveExpiry);
      })
      .map((row) => row.id);

    if (!expiredIds.length) {
      return { checked: liveRows.length, updated: 0 };
    }

    const result = await prisma.hoarding.updateMany({
      where: {
        id: { in: expiredIds },
        status: { equals: 'live', mode: 'insensitive' },
      },
      data: {
        status: 'available',
        bookedById: null,
        bookedAt: null,
        remountStatus: null,
        remountRequestedBy: null,
        remountRequestedAt: null,
        remountCompletedAt: null,
      },
    });

    if ((result?.count || 0) > 0) {
      for (const hoardingId of expiredIds) {
        eventBus.emit('hoarding-status', {
          hoardingId,
          status: 'available',
          hasActiveToken: false,
          updatedAt: new Date().toISOString(),
          source: 'AUTO_EXPIRY_RECONCILE',
        });
      }
    }

    return { checked: liveRows.length, updated: result?.count || 0 };
  }

  private composeRenewalReminderMessage(args: {
    clientName: string;
    hoardingCode: string;
    location: string;
    expiryDate: Date;
    daysRemaining: number;
    senderName: string;
  }) {
    const expiry = args.expiryDate.toLocaleDateString('en-IN');
    return [
      `Dear ${args.clientName},`,
      '',
      `Your hoarding ${args.hoardingCode} at ${args.location} is due for renewal on ${expiry} (in ${args.daysRemaining} days).`,
      '',
      'Please confirm renewal to avoid interruption.',
      '',
      'Regards,',
      args.senderName,
    ].join('\n');
  }

  async listRenewalsDue(input: { actorId: string; actorRole: string; days?: number }) {
    await this.reconcileExpiredLiveHoardings();

    const daysWindow = Math.max(1, Math.min(60, Number(input.days || 15)));
    const now = this.startOfDay(new Date());
    const upTo = this.endOfDay(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysWindow),
    );

    const prismaUnsafe = prisma as unknown as {
      bookingToken: { findMany: (args: unknown) => Promise<RenewalTokenRecord[]> };
      user: { findMany: (args: unknown) => Promise<RenewalUserLite[]> };
      auditLog: {
        findMany: (
          args: unknown,
        ) => Promise<Array<{ entityId?: string | null; userId?: string | null; createdAt: Date }>>;
      };
    };

    const role = String(input.actorRole || '')
      .toLowerCase()
      .trim();
    const where: Record<string, unknown> = {
      hoarding: { status: { equals: 'live', mode: 'insensitive' } },
      status: { notIn: ['CANCELLED', 'RELEASED', 'EXPIRED'] },
    };
    if (role === 'sales') {
      where['salesUserId'] = input.actorId;
    }

    const tokens = await prismaUnsafe.bookingToken.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        client: { select: { id: true, name: true, phone: true } },
        hoarding: {
          select: { id: true, code: true, city: true, area: true, landmark: true, roadName: true },
        },
      },
    });

    if (!tokens.length) return [];

    const latestByHoarding = new Map<string, RenewalTokenRecord>();
    for (const token of tokens) {
      const key = String(token.hoardingId || '');
      if (!key) continue;
      if (!latestByHoarding.has(key)) {
        latestByHoarding.set(key, token);
      }
    }

    const dueTokens = Array.from(latestByHoarding.values()).filter((token) => {
      if (!token.dateTo) return false;
      const expiry = new Date(token.dateTo);
      return expiry <= upTo;
    });

    if (!dueTokens.length) return [];

    const tokenIds = dueTokens.map((token) => String(token.id));
    const logs = await prismaUnsafe.auditLog.findMany({
      where: {
        action: 'BOOKINGTOKEN_RENEWAL_REMINDER_SENT',
        entityType: 'BookingToken',
        entityId: { in: tokenIds },
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestLogByTokenId = new Map<string, { userId?: string | null; createdAt: Date }>();
    for (const log of logs) {
      const tokenId = String(log.entityId || '');
      if (!tokenId || latestLogByTokenId.has(tokenId)) continue;
      latestLogByTokenId.set(tokenId, { userId: log.userId || null, createdAt: log.createdAt });
    }

    const sentByIds = Array.from(
      new Set(
        Array.from(latestLogByTokenId.values())
          .map((log) => String(log.userId || ''))
          .filter((id) => id.length > 0),
      ),
    );

    const users = sentByIds.length
      ? await prismaUnsafe.user.findMany({
          where: { id: { in: sentByIds } },
          select: { id: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return dueTokens
      .map((token) => {
        const endDate = token.dateTo ? new Date(token.dateTo) : null;
        const daysRemaining = endDate ? this.daysBetween(new Date(), endDate) : null;
        const cl = token.client || null;
        const ho = token.hoarding || null;
        const locationParts = [ho?.landmark, ho?.area, ho?.roadName, ho?.city].filter(Boolean);
        const latestLog = latestLogByTokenId.get(String(token.id));
        return {
          id: token.id,
          clientName: cl?.name || '—',
          clientPhone: cl?.phone || '—',
          hoardingCode: ho?.code || '—',
          location: locationParts.length ? locationParts.join(', ') : '—',
          contractStartDate: token.dateFrom || null,
          contractExpiryDate: token.dateTo || null,
          daysRemaining,
          renewalMessageSent: !!latestLog,
          renewalMessageSentAt: latestLog?.createdAt || null,
          renewalMessageSentBy: latestLog?.userId
            ? userMap.get(String(latestLog.userId))?.name || null
            : null,
        };
      })
      .sort((a, b) => {
        const aDate = a.contractExpiryDate
          ? new Date(a.contractExpiryDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bDate = b.contractExpiryDate
          ? new Date(b.contractExpiryDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
  }

  async sendRenewalReminder(
    contractId: string,
    actor: { id: string; name?: string; role?: string },
  ) {
    const actorId = String(actor.id || '').trim();
    if (!actorId) throw new ForbiddenError('Unauthorized');

    const prismaUnsafe = prisma as unknown as {
      bookingToken: {
        findUnique: (args: unknown) => Promise<RenewalTokenRecord | null>;
      };
      auditLog: {
        create: (args: unknown) => Promise<unknown>;
        findFirst: (args: unknown) => Promise<{ id: string } | null>;
      };
    };

    const token = await prismaUnsafe.bookingToken.findUnique({
      where: { id: contractId },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        hoarding: {
          select: {
            id: true,
            code: true,
            city: true,
            area: true,
            landmark: true,
            roadName: true,
            status: true,
          },
        },
      },
    });
    if (!token) throw new NotFoundError('Hoarding renewal record not found');
    if (!token.dateTo) throw new BadRequestError('Expiry date is missing');

    const hoardingId = String(token.hoarding?.id || token.hoardingId || '').trim();
    if (hoardingId) {
      await this.reconcileExpiredLiveHoardings({ hoardingId });
    }

    const freshHoarding = hoardingId
      ? await prisma.hoarding.findUnique({
          where: { id: hoardingId },
          select: { status: true },
        })
      : null;

    if (String(freshHoarding?.status || token?.hoarding?.status || '').toLowerCase() !== 'live') {
      throw new BadRequestError('Renewal reminder can be sent only for live hoardings');
    }

    const expiryDate = new Date(token.dateTo);
    const upTo = this.endOfDay(new Date(new Date().setDate(new Date().getDate() + 15)));
    if (expiryDate > upTo) {
      throw new BadRequestError('Hoarding is not within renewal due window (15-day cutoff)');
    }

    const alreadySent = await prismaUnsafe.auditLog.findFirst({
      where: {
        action: 'BOOKINGTOKEN_RENEWAL_REMINDER_SENT',
        entityType: 'BookingToken',
        entityId: String(token.id),
      },
    });
    if (alreadySent) {
      throw new BadRequestError('Renewal reminder already sent for this hoarding');
    }

    if (String(actor.role || '').toLowerCase() === 'sales') {
      const salesUserId = String(token.salesUserId || '');
      if (salesUserId && salesUserId !== actorId) {
        throw new ForbiddenError('You can send reminders only for your hoardings');
      }
    }

    const clientName = token.client?.name || 'Client';
    const clientPhone = token.client?.phone || null;
    const hoardingCode = token.hoarding?.code || 'Hoarding';
    const locationParts = [
      token.hoarding?.landmark,
      token.hoarding?.area,
      token.hoarding?.roadName,
      token.hoarding?.city,
    ].filter(Boolean);
    const location = locationParts.length ? locationParts.join(', ') : 'the mentioned location';
    const daysRemaining = this.daysBetween(new Date(), expiryDate);
    const senderName = String(actor.name || 'Sales Team').trim() || 'Sales Team';
    const message = this.composeRenewalReminderMessage({
      clientName,
      hoardingCode,
      location,
      expiryDate,
      daysRemaining,
      senderName,
    });

    const sentAt = new Date();

    try {
      await prismaUnsafe.auditLog.create({
        data: {
          userId: actorId,
          action: 'BOOKINGTOKEN_RENEWAL_REMINDER_SENT',
          entityType: 'BookingToken',
          entityId: String(token.id),
          payload: {
            channel: 'WHATSAPP_MOCK',
            toPhone: clientPhone,
            clientName,
            hoardingCode,
            location,
            expiryDate: expiryDate.toISOString(),
            daysRemaining,
            message,
            sentAt: sentAt.toISOString(),
          },
        },
      });
    } catch (_) {}

    return {
      id: token.id,
      renewalMessageSent: true,
      renewalMessageSentAt: sentAt,
      renewalMessageSentBy: senderName,
      message,
      channel: 'WHATSAPP_MOCK',
    };
  }

  async activatePendingForHoarding(hoardingId: string, activationDate: Date, actorId?: string) {
    const pending = await this.repo.findPendingByHoarding(hoardingId);
    if (!pending || pending.length === 0) return;

    const toActivate = pending.filter((c: any) => !c.startDate).map((c: any) => c.id);
    if (toActivate.length === 0) return;

    // Build update payload per-contract (duration may vary)
    for (const c of pending) {
      if (c.startDate) continue; // skip already activated
      const start = activationDate;
      let end = this.addMonths(start, c.durationMonths || 0);
      // If this was a day-based booking (durationMonths === 0) and created from a booking token,
      // prefer the booking token's explicit dateTo if available so endDate reflects the selected days.
      if ((c.durationMonths === 0 || !c.durationMonths) && c.bookingId) {
        try {
          const token = await prisma.bookingToken.findUnique({ where: { id: c.bookingId } });
          if (token && (token as any).dateTo) {
            end = new Date((token as any).dateTo);
          }
        } catch (_) {}
      }
      try {
        const prismaUnsafe = prisma as unknown as {
          contract: { update: (args: unknown) => Promise<unknown> };
          auditLog: { create: (args: unknown) => Promise<unknown> };
        };
        await prismaUnsafe.contract.update({
          where: { id: c.id },
          data: {
            startDate: start,
            endDate: end,
            activatedAt: activationDate,
            status: 'ACTIVE',
          } as any,
        });

        // Audit log
        try {
          await prismaUnsafe.auditLog.create({
            data: {
              userId: actorId || null,
              action: 'CONTRACT_ACTIVATED',
              entityType: 'Contract',
              entityId: c.id,
              payload: {
                contractId: c.id,
                hoardingId,
                activatedAt: activationDate.toISOString(),
              },
            },
          });
        } catch (_) {}

        // Notify Owner/Manager/Sales
        try {
          const recipients = new Set<string>();
          const mgrs = await this.userRepo.findByRoles(['owner', 'manager']);
          mgrs.forEach((u: any) => recipients.add(u.id));
          if (c.createdById) recipients.add(c.createdById);
          const recips = Array.from(recipients).filter(Boolean);
          if (recips.length > 0) {
            await this.notification.notifyUsersIdempotent(
              recips,
              'Contract Activated',
              `Contract ${c.contractNumber} activated. Start: ${start.toISOString().split('T')[0]} End: ${end.toISOString().split('T')[0]}`,
              `/contracts/${c.id}`,
              `CONTRACT_ACTIVATED:${c.id}`,
            );
          }
        } catch (_) {}
      } catch (_) {}
    }
  }

  async listAll() {
    return this.repo.listAll();
  }

  async getById(contractId: string) {
    const prismaUnsafe = prisma as unknown as {
      contract: { findUnique: (args: unknown) => Promise<any> };
    };
    const c = await prismaUnsafe.contract.findUnique({ where: { id: contractId } });
    if (!c) throw new NotFoundError('Contract not found');
    return c;
  }

  async createContract(
    payload: {
      clientId: string;
      hoardingId: string;
      bookingId?: string;
      durationMonths: number;
      basePrice: number;
      totalValue: number;
      paymentTerms: string;
    },
    createdById: string,
  ) {
    const prismaUnsafe = prisma as unknown as {
      contract: { create: (args: unknown) => Promise<unknown> };
    };
    const contractNumber = `C-${Date.now()}`;
    // Try to fetch client name and hoarding code for denormalized fields
    let clientName: string | null = null;
    let hoardingCode: string | null = null;
    try {
      const c = await prisma.client.findUnique({ where: { id: payload.clientId } });
      if (c) clientName = (c as any).name || null;
    } catch (_) {}
    try {
      const h = await prisma.hoarding.findUnique({ where: { id: payload.hoardingId } });
      if (h) hoardingCode = (h as any).code || null;
    } catch (_) {}

    const data: any = {
      contractNumber,
      clientId: payload.clientId,
      hoardingId: payload.hoardingId,
      bookingId: payload.bookingId || null,
      durationMonths: payload.durationMonths,
      basePrice: payload.basePrice,
      totalValue: payload.totalValue,
      paymentTerms: payload.paymentTerms,
      status: 'PENDING_ACTIVATION',
      clientName,
      hoardingCode,
      createdById,
    };
    try {
      const created = (await prismaUnsafe.contract.create({ data } as any)) as any;
      return created;
    } catch (err: any) {
      // If Prisma schema/client is out of sync and doesn't accept denormalized fields,
      // retry without them (keeps runtime resilient until `prisma generate` is run).
      const msg = String(err?.message || '').toLowerCase();
      if (
        msg.includes('unknown argument') ||
        msg.includes('clientname') ||
        msg.includes('hoardingcode')
      ) {
        const minimal = { ...data };
        delete minimal.clientName;
        delete minimal.hoardingCode;
        try {
          const created = (await prismaUnsafe.contract.create({ data: minimal } as any)) as any;
          return created;
        } catch (err2) {
          throw err2;
        }
      }
      throw err;
    }
  }

  async renewContract(
    contractId: string,
    actorId: string,
    opts?: {
      requestOnly?: boolean;
      durationMonths?: number;
      basePrice?: number;
      totalValue?: number;
      paymentTerms?: string;
    },
  ) {
    const prismaUnsafe = prisma as unknown as {
      contract: {
        findUnique: (args: unknown) => Promise<any>;
        create: (args: unknown) => Promise<any>;
        update: (args: unknown) => Promise<any>;
      };
      auditLog: { create: (args: unknown) => Promise<any> };
    };
    const existing = await prismaUnsafe.contract.findUnique({ where: { id: contractId } });
    if (!existing) throw new NotFoundError('Contract not found');

    if (opts?.requestOnly) {
      // Create a notification for managers/owners
      try {
        const mgrs = await this.userRepo.findByRoles(['owner', 'manager']);
        const recips = mgrs.map((u: any) => u.id);
        await this.notification.notifyUsersIdempotent(
          recips,
          'Renewal requested',
          `Renewal requested for contract ${existing.contractNumber}`,
          `/contracts/${contractId}`,
          `RENEW_REQUEST:${contractId}`,
        );
      } catch (_) {}
      return { requested: true };
    }

    // Create new contract copying fields unless overridden
    const duration = opts?.durationMonths ?? existing.durationMonths;
    const basePrice = opts?.basePrice ?? existing.basePrice;
    const totalValue = opts?.totalValue ?? existing.totalValue;
    const paymentTerms = opts?.paymentTerms ?? existing.paymentTerms;
    const contractNumber = `C-${Date.now()}`;

    // Perform renewal in a transaction to ensure atomicity and auditability
    const txResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Build create payload including denormalized fields when available
      const createPayload: any = {
        contractNumber,
        clientId: existing.clientId,
        hoardingId: existing.hoardingId,
        bookingId: null,
        durationMonths: duration,
        basePrice: basePrice,
        totalValue: totalValue,
        paymentTerms: paymentTerms,
        status: 'PENDING_ACTIVATION',
        renewedFromId: existing.id,
        createdById: actorId,
      };
      if ((existing as any).clientName) createPayload.clientName = (existing as any).clientName;
      if ((existing as any).hoardingCode)
        createPayload.hoardingCode = (existing as any).hoardingCode;

      // Attempt create; if db/client rejects denormalized fields, retry without them
      let createdNew: any;
      try {
        createdNew = await (tx as any).contract.create({ data: createPayload });
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        if (
          msg.includes('unknown argument') ||
          msg.includes('clientname') ||
          msg.includes('hoardingcode')
        ) {
          const minimal = { ...createPayload };
          delete minimal.clientName;
          delete minimal.hoardingCode;
          createdNew = await (tx as any).contract.create({ data: minimal });
        } else {
          throw err;
        }
      }

      await (tx as any).contract.update({
        where: { id: existing.id },
        data: { status: 'COMPLETED' },
      });

      try {
        await (tx as any).auditLog.create({
          data: {
            userId: actorId,
            action: 'CONTRACT_RENEWED',
            entityType: 'Contract',
            entityId: existing.id,
            payload: { newContractId: (createdNew as any).id },
          },
        });
      } catch (_) {}

      return createdNew;
    });

    return txResult as any;
  }

  async cancelContract(contractId: string, actorId: string) {
    const prismaUnsafe = prisma as unknown as {
      contract: {
        findUnique: (args: unknown) => Promise<any>;
        update: (args: unknown) => Promise<any>;
      };
      auditLog: { create: (args: unknown) => Promise<any> };
      hoarding: { update: (args: unknown) => Promise<any> };
    };
    const existing = await prismaUnsafe.contract.findUnique({ where: { id: contractId } });
    if (!existing) throw new NotFoundError('Contract not found');

    await prismaUnsafe.contract.update({
      where: { id: contractId },
      data: { status: 'CANCELLED' },
    });
    try {
      await prismaUnsafe.auditLog.create({
        data: {
          userId: actorId,
          action: 'CONTRACT_CANCELLED',
          entityType: 'Contract',
          entityId: contractId,
        },
      });
    } catch (_) {}

    // If contract was active, free the hoarding
    try {
      if (existing.status === 'ACTIVE') {
        await prismaUnsafe.hoarding.update({
          where: { id: existing.hoardingId },
          data: { status: 'available' },
        });
      }
    } catch (_) {}

    return { cancelled: true };
  }

  async runExpiryJob(alertDays: number) {
    // Ensure any live hoarding with completed tenure becomes available
    await this.reconcileExpiredLiveHoardings();

    // Expiring soon
    const expiring = await this.repo.findActiveExpiringWithinDays(alertDays);
    if (expiring && expiring.length) {
      const ids = expiring.map((c: any) => c.id);
      await this.repo.markStatus(ids, 'EXPIRING_SOON');
      // notify
      for (const c of expiring) {
        try {
          const recipients = new Set<string>();
          const mgrs = await this.userRepo.findByRoles(['owner', 'manager']);
          mgrs.forEach((u: any) => recipients.add(u.id));
          if (c.createdById) recipients.add(c.createdById);
          const recips = Array.from(recipients).filter(Boolean);
          if (recips.length) {
            await this.notification.notifyUsersIdempotent(
              recips,
              'Contract Expiring Soon',
              `Contract ${c.contractNumber} expires on ${new Date(c.endDate).toISOString().split('T')[0]}`,
              `/contracts/${c.id}`,
              `CONTRACT_EXPIRY_SOON:${c.id}`,
            );
          }
        } catch (_) {}
      }
    }

    // Post expiry: mark completed if past due and no renewals
    const pastDue = await this.repo.findActivePastDueWithoutRenewal();
    if (pastDue && pastDue.length) {
      const ids = pastDue.map((c: any) => c.id);
      await this.repo.markStatus(ids, 'COMPLETED');
      for (const c of pastDue) {
        try {
          // Make hoarding available
          await prisma.hoarding.update({
            where: { id: c.hoardingId },
            data: { status: 'available' } as any,
          });
        } catch (_) {}
        try {
          await this.notification.notifyUsersIdempotent(
            [c.createdById],
            'Contract Completed',
            `Contract ${c.contractNumber} has completed. Hoarding is now available.`,
            `/contracts/${c.id}`,
            `CONTRACT_COMPLETED:${c.id}`,
          );
        } catch (_) {}
      }
    }
  }
}
