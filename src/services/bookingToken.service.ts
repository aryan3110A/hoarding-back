import { Prisma, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { BookingTokenRepository } from '../repositories/bookingToken.repository';
import { BookingRepository } from '../repositories/booking.repository';
import { HoardingRepository } from '../repositories/hoarding.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotificationService } from './notification.service';
import { ClientService } from './client.service';
import { ContractService } from './contract.service';
import { BillingEventService } from './billingEvent.service';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '../lib/errors';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';

const EXPIRY_HOURS = 48; // Phase-3 default block duration

const LEGACY_EXT_MARKER_RE = /\[\[EXT_REQ until=([^\]]+)\]\]/;
const PROPOSAL_TOKEN_MARKER_RE = /\[\[PROPOSAL_ID:([^\]]+)\]\]/;
function parseLegacyExtensionRequestedUntil(notes?: string | null): Date | null {
  const raw = String(notes || '');
  const m = raw.match(LEGACY_EXT_MARKER_RE);
  if (!m || !m[1]) return null;
  const d = new Date(m[1]);
  if (isNaN(d.getTime())) return null;
  return d;
}

function stripLegacyExtensionMarker(notes?: string | null): string | null {
  const raw = String(notes || '');
  const stripped = raw.replace(LEGACY_EXT_MARKER_RE, '').trim();
  return stripped.length > 0 ? stripped : null;
}

function upsertLegacyExtensionMarker(notes: string | null | undefined, until: Date): string {
  const base = String(stripLegacyExtensionMarker(notes) || '').trim();
  const marker = `[[EXT_REQ until=${until.toISOString()}]]`;
  return base.length > 0 ? `${base}\n${marker}` : marker;
}

export class BlockHoardingService {
  private repo: BookingTokenRepository;
  private bookingRepo: BookingRepository;
  private notification: NotificationService;
  private hoardingRepo: HoardingRepository;
  private userRepo: UserRepository;
  private clientSvc: ClientService;
  private contractService: ContractService;
  private billingEventService: BillingEventService;

  constructor() {
    this.repo = new BookingTokenRepository();
    this.bookingRepo = new BookingRepository();
    this.notification = new NotificationService();
    this.hoardingRepo = new HoardingRepository();
    this.userRepo = new UserRepository();
    this.clientSvc = new ClientService();
    this.contractService = new ContractService();
    this.billingEventService = new BillingEventService();
  }

  private async getOwnerAndManagerIds(excludeUserId?: string): Promise<string[]> {
    const users = await this.userRepo.findByRoles(['owner', 'manager', 'admin']);
    const ids = users.map((u: User) => u.id).filter((id: string) => !!id && id !== excludeUserId);
    return Array.from(new Set(ids));
  }

  private async getOwnerManagerSupervisorIds(excludeUserId?: string): Promise<string[]> {
    const users = await this.userRepo.findByRoles(['owner', 'manager', 'admin', 'supervisor']);
    const ids = users.map((u: User) => u.id).filter((id: string) => !!id && id !== excludeUserId);
    return Array.from(new Set(ids));
  }

  private computeExpiresAt(hours = EXPIRY_HOURS): Date {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    return d;
  }

  private async assertPhase3EnabledOrThrow(): Promise<void> {
    const ok = await supportsPhase3BlockingSchema();
    if (!ok) {
      throw new BadRequestError(
        'Phase 3 blocking workflow is not available because the database has not been migrated yet.',
      );
    }
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Handle month rollover (e.g. Jan 31 + 1 month)
    if (d.getDate() < day) {
      d.setDate(0);
    }
    return d;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private isPastExpiryEnd(dateValue?: Date | string | null): boolean {
    if (!dateValue) return false;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    d.setHours(23, 59, 59, 999);
    return Date.now() > d.getTime();
  }

  private async normalizeQueueAndEnsureHeadBlocked(
    tx: Prisma.TransactionClient,
    args: { hoardingId: string; from: Date; to: Date },
  ): Promise<{
    headTokenId: string | null;
    headSalesUserId: string | null;
    headPromotedToBlocked: boolean;
  }> {
    // This workflow relies on Phase-3 enum values + columns.
    // If the DB isn't migrated, callers should use legacy flow.
    // (We keep this method strict to avoid writing invalid enum values.)
    await this.assertPhase3EnabledOrThrow();
    const now = new Date();
    const rows = await tx.bookingToken.findMany({
      where: {
        hoardingId: args.hoardingId,
        OR: [{ AND: [{ dateFrom: { lte: args.to } }, { dateTo: { gte: args.from } }] }],
        status: { in: ['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, salesUserId: true },
    });

    let headTokenId: string | null = null;
    let headSalesUserId: string | null = null;
    let headPromotedToBlocked = false;

    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx] as unknown as {
        id: string;
        status: string;
        salesUserId: string;
      };
      const position = idx + 1;

      if (idx === 0) {
        headTokenId = row.id;
        headSalesUserId = row.salesUserId;
      }

      // Only the head can hold the block.
      // - EXTENSION_REQUESTED remains head-only and keeps its existing expiresAt until approved.
      // - BLOCKED remains as-is (do not extend).
      // - PENDING/ACTIVE is promoted to BLOCKED (set new expiresAt + blockedAt).
      const normalizedStatus =
        idx === 0
          ? String(row.status || '')
              .toUpperCase()
              .trim()
          : 'PENDING';

      if (idx === 0) {
        if (normalizedStatus === 'EXTENSION_REQUESTED') {
          await tx.bookingToken.update({
            where: { id: row.id },
            data: { queuePosition: position },
          });
          continue;
        }

        if (normalizedStatus === 'BLOCKED') {
          await tx.bookingToken.update({
            where: { id: row.id },
            data: { queuePosition: position },
          });
          continue;
        }

        // Promote to BLOCKED
        headPromotedToBlocked = true;
        await tx.bookingToken.update({
          where: { id: row.id },
          data: {
            queuePosition: position,
            status: 'BLOCKED',
            blockedAt: now,
            expiresAt: this.computeExpiresAt(EXPIRY_HOURS),
          },
        });
        continue;
      }

      // Non-head items are always pending.
      await tx.bookingToken.update({
        where: { id: row.id },
        data: {
          queuePosition: position,
          status: 'PENDING',
          extensionRequestedAt: null,
          extensionRequestedUntil: null,
        },
      });
    }

    return { headTokenId, headSalesUserId, headPromotedToBlocked };
  }

  async createBlock(input: {
    hoardingId: string;
    dateFrom: string;
    dateTo?: string;
    durationMonths?: number;
    notes?: string;
    client: { name: string; phone: string; email?: string; companyName?: string };
    salesUserId: string;
    actorRoleName?: string;
  }): Promise<{
    blockId: string;
    queuePosition: number;
    client: { id: string; name: string; phone: string };
  }> {
    if (!input.hoardingId) throw new BadRequestError('Hoarding is required');

    const from = new Date(input.dateFrom);
    if (isNaN(from.getTime())) throw new BadRequestError('Booking start date is required');

    // Determine durationMonths. Prefer explicit `durationMonths`, fallback to legacy `dateTo` if provided.
    const hadDurationProvided =
      typeof input.durationMonths === 'number' && !isNaN(input.durationMonths);
    let duration: number | undefined = undefined;
    let computedMonthsFromDateTo: number | undefined = undefined;
    if (hadDurationProvided) {
      duration = Number(input.durationMonths);
    } else if (typeof input.dateTo === 'string' && input.dateTo.length > 0) {
      const toFromPayload = new Date(input.dateTo);
      if (isNaN(toFromPayload.getTime())) throw new BadRequestError('Invalid booking end date');
      // compute full months between from and to
      const monthsDiff =
        (toFromPayload.getFullYear() - from.getFullYear()) * 12 +
        (toFromPayload.getMonth() - from.getMonth());
      // if day of to is before day of from, subtract one month
      const dayAdjustment = toFromPayload.getDate() < from.getDate() ? -1 : 0;
      computedMonthsFromDateTo = monthsDiff + dayAdjustment;
      // keep duration undefined for day-based bookings if computed months is 0
      if (computedMonthsFromDateTo > 0) duration = computedMonthsFromDateTo;
    }

    // Validate duration: if user explicitly provided durationMonths enforce allowed buckets.
    // Otherwise accept a provided dateTo (day-based booking) even if month-diff is 0.
    if (hadDurationProvided) {
      if (![3, 6, 9, 12].includes(Number(input.durationMonths))) {
        throw new BadRequestError(
          'Invalid booking duration; allowed durations (months): 3, 6, 9, 12',
        );
      }
    } else if (!(typeof input.dateTo === 'string' && input.dateTo.length > 0)) {
      // neither a valid durationMonths nor a dateTo provided
      throw new BadRequestError(
        'Invalid booking duration; provide duration (months): 3,6,9,12 or specify an end date',
      );
    }

    // Compute `to` either from months (standard flow) or use provided dateTo (day-based)
    let to: Date;
    if (typeof duration === 'number') {
      to = this.addMonths(from, duration);
    } else {
      to = new Date(String(input.dateTo));
    }
    if (to.getTime() <= from.getTime()) throw new BadRequestError('Invalid date range');

    const hoarding = await this.hoardingRepo.findById(input.hoardingId);
    if (!hoarding) throw new NotFoundError('Hoarding not found');
    let hoardingStatus = String(hoarding.status || '')
      .toLowerCase()
      .trim();

    if (hoardingStatus === 'live') {
      const hoardingWithExpiry = hoarding as typeof hoarding & { expiryDate?: Date | null };
      let effectiveExpiry: Date | string | null = hoardingWithExpiry.expiryDate || null;
      if (!effectiveExpiry) {
        const latestToken = await prisma.bookingToken.findFirst({
          where: {
            hoardingId: input.hoardingId,
            status: { notIn: ['CANCELLED', 'RELEASED'] },
          },
          orderBy: [{ createdAt: 'desc' }],
          select: { dateTo: true },
        });
        effectiveExpiry = latestToken?.dateTo || null;
      }

      if (this.isPastExpiryEnd(effectiveExpiry)) {
        try {
          await this.hoardingRepo.update(input.hoardingId, {
            status: 'available',
            bookedById: null,
            bookedAt: null,
            remountStatus: null,
            remountRequestedBy: null,
            remountRequestedAt: null,
            remountCompletedAt: null,
          } as unknown as Prisma.HoardingUpdateInput);

          eventBus.emit('hoarding-status', {
            hoardingId: input.hoardingId,
            status: 'available',
            hasActiveToken: false,
            updatedAt: new Date().toISOString(),
            source: 'AUTO_EXPIRY_RECONCILE',
          });

          hoardingStatus = 'available';
        } catch (_) {
          // ignore update failures and continue with existing validation path
        }
      }
    }

    if (hoardingStatus === 'booked') {
      throw new ConflictError('This hoarding is already booked and cannot be tokenized.');
    }
    if (hoardingStatus === 'live') {
      throw new BadRequestError('This hoarding is Live and cannot be tokenized');
    }
    if (hoardingStatus === 'under_process') {
      throw new BadRequestError('This hoarding is Under Process and cannot be tokenized');
    }

    // Create/reuse client first (phone unique)
    const clientUnknown = await this.clientSvc.findOrCreate(input.client, input.salesUserId);
    const client = clientUnknown as unknown as { id: string; name: string; phone: string };

    // Legacy mode (DB not migrated): keep old behavior (single ACTIVE token, no queue/blockedAt)
    const phase3Enabled = await supportsPhase3BlockingSchema();
    if (!phase3Enabled) {
      const overlaps = await this.repo.findActiveOverlaps(input.hoardingId, from, to);
      const queuePosition = (overlaps as unknown[]).length + 1;

      const durationNumber: number = typeof duration === 'number' ? duration : 0;
      const legacyTokenId = randomUUID();
      // Use raw SQL insert to avoid Prisma schema validation (blockDurationHours has @default
      // so even createMany tries to use it, crashing on unmigrated DBs).
      await prisma.$executeRaw`
        INSERT INTO "BookingToken" (
          "id", "hoardingId", "salesUserId", "clientId", "durationMonths",
          "notes", "dateFrom", "dateTo", "status", "queuePosition", "expiresAt", "createdAt"
        ) VALUES (
          ${legacyTokenId}, ${input.hoardingId}, ${input.salesUserId}, ${String(client.id)},
          ${durationNumber}, ${input.notes || null}, ${from}, ${to}, ${'ACTIVE'}::text::"TokenStatus",
          ${queuePosition}, ${this.computeExpiresAt(EXPIRY_HOURS)}, ${new Date()}
        )
      `;

      // Mark hoarding as tokenized
      try {
        await this.hoardingRepo.update(input.hoardingId, {
          status: 'tokenized',
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId: input.hoardingId,
          status: 'tokenized',
          hasActiveToken: true,
          updatedAt: new Date().toISOString(),
        });
      } catch (_) {}

      // Notifications (legacy mode)
      try {
        const hoardingCodeForMessage =
          String((hoarding as unknown as { code?: string } | null)?.code) || input.hoardingId;
        const isProposalToken = PROPOSAL_TOKEN_MARKER_RE.test(String(input.notes || ''));
        if (!isProposalToken) {
          await this.notification.notifyUsers(
            [input.salesUserId],
            'Token created',
            `You are #${queuePosition} in queue for ${hoardingCodeForMessage}.`,
            `/booking-tokens/${legacyTokenId}`,
          );
        }

        if (String(input.actorRoleName || '').toLowerCase() === 'sales') {
          const recipients = await this.getOwnerManagerSupervisorIds(input.salesUserId);
          if (recipients.length > 0) {
            const salesUser = await this.userRepo.findById(input.salesUserId);
            const salesName = salesUser?.name || 'A salesperson';
            const isProposalToken = PROPOSAL_TOKEN_MARKER_RE.test(String(input.notes || ''));
            if (!isProposalToken) {
              await this.notification.notifyUsers(
                recipients,
                'Hoarding tokenized',
                `${hoardingCodeForMessage} tokenized by ${salesName} for Client: ${client.name} (${duration} months). Queue #${queuePosition}.`,
                `/booking-tokens/${legacyTokenId}`,
              );
            }
          }
        }
      } catch (_) {
        // notification failures should not block
      }

      return {
        blockId: legacyTokenId,
        queuePosition,
        client: { id: String(client.id), name: String(client.name), phone: String(client.phone) },
      };
    }

    // Prevent duplicate queue entries by the same sales user for overlapping range
    const existingQueueUnknown = await this.repo.findBlockingByHoardingAndSales(
      input.hoardingId,
      input.salesUserId,
      from,
      to,
    );
    if (existingQueueUnknown) {
      const existing = existingQueueUnknown as unknown as { status?: string; expiresAt?: Date };
      const st = String(existing.status || '').toUpperCase();
      if (st === 'BLOCKED' || st === 'EXTENSION_REQUESTED' || st === 'ACTIVE') {
        const now = new Date();
        const msLeft = Math.max(0, new Date(existing.expiresAt as Date).getTime() - now.getTime());
        const minutes = Math.floor(msLeft / 60000);
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const remaining = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        throw new BadRequestError(
          `You already have an active block for this hoarding. Try again after: ${remaining}`,
        );
      }
      throw new BadRequestError('You have already joined the queue for this hoarding.');
    }

    // Ensure we have a numeric duration value for DB (0 for short/day bookings)
    const durationNumber: number = typeof duration === 'number' ? duration : 0;

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Insert token with provisional position
      const provisional = await tx.bookingToken.create({
        data: {
          hoarding: { connect: { id: input.hoardingId } },
          salesUser: { connect: { id: input.salesUserId } },
          client: { connect: { id: client.id } },
          durationMonths: durationNumber,
          notes: input.notes || null,
          dateFrom: from,
          dateTo: to,
          status: 'PENDING',
          queuePosition: 999999,
          blockedAt: null,
          expiresAt: this.computeExpiresAt(EXPIRY_HOURS),
        },
        select: { id: true },
      });

      // Normalize FIFO queue for the overlapping range and ensure the head is BLOCKED.
      await this.normalizeQueueAndEnsureHeadBlocked(tx, {
        hoardingId: input.hoardingId,
        from,
        to,
      });

      const updated = await tx.bookingToken.findUnique({
        where: { id: provisional.id },
        select: { id: true, queuePosition: true },
      });
      return updated;
    });

    const createdLite = created as unknown as { id: string; queuePosition: number };

    let hoardingCodeForMessage = input.hoardingId;
    try {
      const hoarding = await this.hoardingRepo.findById(input.hoardingId);
      hoardingCodeForMessage = hoarding?.code || input.hoardingId;
    } catch (_) {
      // ignore
    }

    // Notify sales user
    const isProposalToken = PROPOSAL_TOKEN_MARKER_RE.test(String(input.notes || ''));
    if (!isProposalToken) {
      await this.notification.notifyUsers(
        [input.salesUserId],
        'Token created',
        `You are #${createdLite.queuePosition} in queue for ${hoardingCodeForMessage}.`,
        `/booking-tokens/${createdLite.id}`,
      );
    }

    // Notify Owner + Manager when Sales tokenizes
    try {
      if (String(input.actorRoleName || '').toLowerCase() === 'sales') {
        const recipients = await this.getOwnerManagerSupervisorIds(input.salesUserId);
        if (recipients.length > 0) {
          const salesUser = await this.userRepo.findById(input.salesUserId);
          const salesName = salesUser?.name || 'A salesperson';
          const hoardingCode = hoardingCodeForMessage;
          const isProposalToken = PROPOSAL_TOKEN_MARKER_RE.test(String(input.notes || ''));
          if (!isProposalToken) {
            await this.notification.notifyUsers(
              recipients,
              'Hoarding tokenized',
              `${hoardingCode} tokenized by ${salesName} for Client: ${client.name} (${duration} months). Queue #${createdLite.queuePosition}.`,
              `/booking-tokens/${createdLite.id}`,
            );
          }
        }
      }
    } catch (_) {
      // notification failures should not block
    }

    // Mark hoarding as tokenized when a blocked token exists
    try {
      const active = await this.repo.findActiveByHoarding(input.hoardingId);
      if ((active as unknown[]).length > 0) {
        await this.hoardingRepo.update(input.hoardingId, {
          status: 'tokenized',
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId: input.hoardingId,
          status: 'tokenized',
          hasActiveToken: true,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (_) {}

    return {
      blockId: createdLite.id,
      queuePosition: createdLite.queuePosition,
      client: { id: String(client.id), name: String(client.name), phone: String(client.phone) },
    };
  }

  async getTokenDetails(
    id: string,
    actor: { id: string; role: { name: string } },
  ): Promise<unknown> {
    const token = await this.repo.findDetailsById(id);
    if (!token) throw new NotFoundError('Token not found');

    // Legacy DB compatibility: pending extension requests are stored in `notes`.
    // Surface the requested-until timestamp and strip the marker from notes for UI cleanliness.
    const phase3Enabled = await supportsPhase3BlockingSchema();
    if (!phase3Enabled) {
      const notes = (token as unknown as { notes?: string | null }).notes ?? null;
      const until = parseLegacyExtensionRequestedUntil(notes);
      const stripped = stripLegacyExtensionMarker(notes);
      (token as unknown as { notes?: string | null }).notes = stripped;
      if (until) {
        (
          token as unknown as { legacyExtensionRequestedUntil?: string }
        ).legacyExtensionRequestedUntil = until.toISOString();
      }
    }

    const role = String(actor?.role?.name || '').toLowerCase();
    const tokenSalesUserId = String(
      (token as unknown as { salesUserId?: string }).salesUserId || '',
    );
    const tokenDesignerId = String((token as unknown as { designerId?: string }).designerId || '');
    const tokenFitterId = String((token as unknown as { fitterId?: string }).fitterId || '');
    if (role === 'sales' && tokenSalesUserId !== String(actor.id)) {
      throw new ForbiddenError('Not allowed');
    }
    if (role === 'designer' && tokenDesignerId !== String(actor.id)) {
      throw new ForbiddenError('Not allowed');
    }
    if (role === 'fitter' && tokenFitterId !== String(actor.id)) {
      throw new ForbiddenError('Not allowed');
    }
    return token;
  }

  private normalizeDesignStatus(raw: string): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' {
    const s = String(raw || '')
      .trim()
      .toLowerCase();
    if (s === 'pending') return 'PENDING';
    if (s === 'in_progress' || s === 'inprogress') return 'IN_PROGRESS';
    if (s === 'completed') return 'COMPLETED';
    throw new BadRequestError('Invalid design status');
  }

  private normalizeFitterStatus(raw: string): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' {
    const s = String(raw || '')
      .trim()
      .toLowerCase();
    if (s === 'pending') return 'PENDING';
    if (s === 'in_progress' || s === 'inprogress') return 'IN_PROGRESS';
    if (s === 'completed') return 'COMPLETED';
    throw new BadRequestError('Invalid fitter status');
  }

  async listRecentTokens(filters: {
    from?: string;
    to?: string;
    hoardingId?: string;
    salesUserId?: string;
  }): Promise<unknown[]> {
    const from = filters.from ? new Date(String(filters.from)) : undefined;
    const to = filters.to ? new Date(String(filters.to)) : undefined;
    return this.repo.listRecent({
      from: from && !isNaN(from.getTime()) ? from : undefined,
      to: to && !isNaN(to.getTime()) ? to : undefined,
      hoardingId: filters.hoardingId ? String(filters.hoardingId) : undefined,
      salesUserId: filters.salesUserId ? String(filters.salesUserId) : undefined,
      take: 50,
    });
  }

  async confirmToken(
    id: string,
    actorId: string,
    actorRoleName?: string,
    executionType?: string,
    plannedLiveDateInput?: string,
    durationInput?: number | string,
    billingConfig?: {
      paymentPlanType?: string;
      billingFrequency?: string;
      gstApplicable?: boolean;
      finalAgreedBasePrice?: number;
      modeOfPayment?: string;
      printingChargesBase?: number;
      mountingChargesBase?: number;
      poRequired?: boolean;
      poNotes?: string;
      expectedPoDate?: string;
      billingCompanyName?: string;
      billingPhone?: string;
      billingEmail?: string;
      gstin?: string;
      billingAddress?: string;
    },
  ): Promise<void> {
    const roleLower = String(actorRoleName || '').toLowerCase();
    const isSalesConfirmer = roleLower === 'sales';

    const now = new Date();

    const plannedLiveDate = plannedLiveDateInput ? new Date(String(plannedLiveDateInput)) : null;
    if (plannedLiveDate && isNaN(plannedLiveDate.getTime())) {
      throw new BadRequestError('Invalid live date');
    }

    const normalizedPaymentPlanType = String(billingConfig?.paymentPlanType || '')
      .trim()
      .toUpperCase();
    const normalizedBillingFrequency = String(billingConfig?.billingFrequency || '')
      .trim()
      .toUpperCase();
    const allowedPaymentPlanTypes = [
      'ADVANCE_MONTHLY',
      'ADVANCE_FULL_CAMPAIGN',
      'ON_SPOT_LIVE',
      'POST_MONTHLY',
      'END_OF_CAMPAIGN',
      'MONTHLY_IN_HAND',
    ];
    const allowedBillingFrequencies = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'];
    const gstApplicable =
      typeof billingConfig?.gstApplicable === 'boolean' ? billingConfig.gstApplicable : null;
    const finalAgreedBasePrice =
      billingConfig?.finalAgreedBasePrice !== undefined &&
      billingConfig?.finalAgreedBasePrice !== null &&
      !Number.isNaN(Number(billingConfig.finalAgreedBasePrice))
        ? Number(billingConfig.finalAgreedBasePrice)
        : null;
    const modeOfPayment = String(billingConfig?.modeOfPayment || '').trim();
    const printingChargesBase = Number(billingConfig?.printingChargesBase || 0);
    const mountingChargesBase = Number(billingConfig?.mountingChargesBase || 0);
    const poRequired =
      typeof billingConfig?.poRequired === 'boolean' ? billingConfig.poRequired : false;
    const poNotes = String(billingConfig?.poNotes || '').trim();
    const expectedPoDate = billingConfig?.expectedPoDate
      ? new Date(String(billingConfig.expectedPoDate))
      : null;
    if (expectedPoDate && Number.isNaN(expectedPoDate.getTime())) {
      throw new BadRequestError('Invalid expected PO date');
    }

    type UnsafeTx = Prisma.TransactionClient & {
      bookingToken: {
        findUnique: (args: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<unknown>;
        findMany: (args: unknown) => Promise<unknown[]>;
        updateMany: (args: unknown) => Promise<unknown>;
      };
      hoarding: {
        findUnique: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
      booking: {
        create: (args: unknown) => Promise<unknown>;
        findFirst: (args: unknown) => Promise<unknown>;
      };
      user: {
        findUnique: (args: unknown) => Promise<unknown>;
        findMany: (args: unknown) => Promise<unknown[]>;
      };
    };

    type ConfirmResult = {
      tokenId: string;
      hoardingId: string;
      salesUserId: string;
      clientId: string;
      cancelledSalesUserIds: string[];
      executionType: 'CLIENT_CDR' | 'IN_HOUSE_DESIGN' | 'CLIENT_DIRECT_FLEX' | null;
    };

    const result = (await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const unsafeTx = tx as unknown as UnsafeTx;

      const token = (await unsafeTx.bookingToken.findUnique({
        where: { id },
        select: {
          id: true,
          hoardingId: true,
          dateFrom: true,
          dateTo: true,
          durationMonths: true,
          status: true,
          expiresAt: true,
          salesUserId: true,
          clientId: true,
          queuePosition: true,
          designerId: true,
        },
      })) as {
        id: string;
        hoardingId: string;
        dateFrom: Date;
        dateTo: Date;
        durationMonths: number | null;
        status: string;
        expiresAt: Date;
        salesUserId: string;
        clientId: string;
        queuePosition: number;
        designerId: string | null;
      } | null;
      if (!token) throw new NotFoundError('Token not found');

      if (isSalesConfirmer && String(token.salesUserId) !== String(actorId)) {
        throw new ForbiddenError('Sales can only confirm their own token');
      }

      // If the hoarding is already under_process, always return the same message
      // (even if this particular token is no longer ACTIVE).
      const hoardingRow = (await unsafeTx.hoarding.findUnique({
        where: { id: token.hoardingId },
        select: { status: true, executionType: true },
      })) as { status?: unknown; executionType?: unknown } | null;
      const hoardingStatusLower = String(hoardingRow?.status || '')
        .toLowerCase()
        .trim();
      if (hoardingStatusLower === 'booked') {
        throw new BadRequestError('This hoarding is already Booked');
      }
      if (hoardingStatusLower === 'under_process') {
        const existing = (await unsafeTx.booking.findFirst({
          where: { hoardingId: token.hoardingId, status: 'under_process' },
          orderBy: { createdAt: 'desc' },
          select: {
            createdByUser: { select: { role: { select: { name: true } } } },
          },
        })) as { createdByUser?: { role?: { name?: unknown } } } | null;
        const confirmedBy = String(existing?.createdByUser?.role?.name || '').toLowerCase();
        if (confirmedBy) {
          throw new BadRequestError(
            `This hoarding is already Under Process (confirmed by ${confirmedBy})`,
          );
        }
        throw new BadRequestError('This hoarding is already Under Process');
      }

      const stUpper = String(token.status || '').toUpperCase();
      const confirmableStatuses = ['BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'];
      if (!confirmableStatuses.includes(stUpper)) throw new ForbiddenError('Token not active');
      if (token.expiresAt < now && stUpper !== 'ACTIVE') throw new ForbiddenError('Token expired');
      if (token.queuePosition !== 1) throw new ForbiddenError('Not first in queue');

      const rawExecutionType = String(executionType || '')
        .trim()
        .toUpperCase();
      const isValidExecutionType =
        rawExecutionType === 'CLIENT_CDR' ||
        rawExecutionType === 'IN_HOUSE_DESIGN' ||
        rawExecutionType === 'CLIENT_DIRECT_FLEX';
      const existingExecutionType = String(hoardingRow?.executionType || '')
        .trim()
        .toUpperCase();

      if (isSalesConfirmer && !rawExecutionType) {
        throw new BadRequestError('Execution type is required to finalize');
      }
      if (isSalesConfirmer && !plannedLiveDate) {
        throw new BadRequestError('Live date is required to finalize');
      }
      if (rawExecutionType && !isValidExecutionType) {
        throw new BadRequestError('Invalid execution type');
      }
      if (
        rawExecutionType &&
        existingExecutionType &&
        existingExecutionType !== rawExecutionType &&
        !isSalesConfirmer
      ) {
        throw new BadRequestError('Execution type is already set and cannot be changed');
      }
      const executionTypeToSet = rawExecutionType
        ? (rawExecutionType as 'CLIENT_CDR' | 'IN_HOUSE_DESIGN' | 'CLIENT_DIRECT_FLEX')
        : null;
      const resolvedExecutionType =
        executionTypeToSet ||
        (existingExecutionType === 'CLIENT_CDR' ||
        existingExecutionType === 'IN_HOUSE_DESIGN' ||
        existingExecutionType === 'CLIENT_DIRECT_FLEX'
          ? (existingExecutionType as 'CLIENT_CDR' | 'IN_HOUSE_DESIGN' | 'CLIENT_DIRECT_FLEX')
          : null);

      const allowedDurationMonths = [1, 3, 6, 9, 12];
      let selectedDurationMonths: number | null = null;
      let selectedDurationDays: number | null = null;
      if (typeof durationInput === 'number' && !Number.isNaN(durationInput)) {
        if (!allowedDurationMonths.includes(Number(durationInput))) {
          throw new BadRequestError('Invalid duration; allowed months are 1, 3, 6, 9, 12');
        }
        selectedDurationMonths = Number(durationInput);
      } else if (typeof durationInput === 'string' && durationInput.trim()) {
        const rawDuration = durationInput.trim().toLowerCase();
        if (rawDuration.endsWith('d')) {
          const dayCount = parseInt(rawDuration.replace('d', ''), 10);
          if (dayCount !== 8) {
            throw new BadRequestError('Invalid day duration; only 8 days is allowed');
          }
          selectedDurationDays = dayCount;
        } else {
          const monthCount = Number(rawDuration);
          if (Number.isNaN(monthCount) || !allowedDurationMonths.includes(monthCount)) {
            throw new BadRequestError('Invalid duration; allowed months are 1, 3, 6, 9, 12');
          }
          selectedDurationMonths = monthCount;
        }
      }

      if (isSalesConfirmer && selectedDurationMonths === null && selectedDurationDays === null) {
        throw new BadRequestError('Duration is required to finalize');
      }
      if (isSalesConfirmer && !allowedPaymentPlanTypes.includes(normalizedPaymentPlanType)) {
        throw new BadRequestError('Payment plan type is required to finalize');
      }
      if (isSalesConfirmer && !allowedBillingFrequencies.includes(normalizedBillingFrequency)) {
        throw new BadRequestError('Billing frequency is required to finalize');
      }
      if (isSalesConfirmer && gstApplicable === null) {
        throw new BadRequestError('GST applicability is required to finalize');
      }
      if (
        isSalesConfirmer &&
        (finalAgreedBasePrice === null || Number.isNaN(finalAgreedBasePrice) || finalAgreedBasePrice <= 0)
      ) {
        throw new BadRequestError('Final agreed base price is required to finalize');
      }
      if (isSalesConfirmer && !modeOfPayment) {
        throw new BadRequestError('Mode of payment is required to finalize');
      }
      if (Number.isNaN(printingChargesBase) || printingChargesBase < 0) {
        throw new BadRequestError('Printing charges must be 0 or more');
      }
      if (Number.isNaN(mountingChargesBase) || mountingChargesBase < 0) {
        throw new BadRequestError('Mounting charges must be 0 or more');
      }

      const effectiveDateFrom =
        isSalesConfirmer && plannedLiveDate ? new Date(plannedLiveDate) : new Date(token.dateFrom);
      let effectiveDateTo = new Date(token.dateTo);
      let durationMonthsToPersist: number | null = token.durationMonths ?? null;

      if (selectedDurationMonths !== null) {
        effectiveDateTo = this.addMonths(effectiveDateFrom, selectedDurationMonths);
        durationMonthsToPersist = selectedDurationMonths;
      } else if (selectedDurationDays !== null) {
        effectiveDateTo = this.addDays(effectiveDateFrom, selectedDurationDays);
        durationMonthsToPersist = 0;
      }

      if (effectiveDateTo.getTime() <= effectiveDateFrom.getTime()) {
        throw new BadRequestError('Invalid duration range');
      }

      const nextHoardingStatus = isSalesConfirmer ? 'booked' : 'under_process';
      const nextBookingStatus = isSalesConfirmer ? 'confirmed' : 'under_process';

      // Atomically claim the hoarding: only one confirmer can move it to the next state.
      const claimed = await unsafeTx.hoarding.updateMany({
        where: {
          id: token.hoardingId,
          status: {
            notIn: ['under_process', 'occupied', 'booked'],
          },
        },
        data: {
          status: nextHoardingStatus,
          workflowState: isSalesConfirmer ? 'READY_FOR_SUPERVISOR_ACTION' : undefined,
          bookedById: isSalesConfirmer ? actorId : undefined,
          bookedAt: isSalesConfirmer ? now : undefined,
          executionType: executionTypeToSet ? executionTypeToSet : undefined,
        },
      });

      if (claimed.count === 0) {
        // Somebody already moved it to under_process (or it's already on rent/occupied).
        const existing = (await unsafeTx.booking.findFirst({
          where: { hoardingId: token.hoardingId, status: 'under_process' },
          orderBy: { createdAt: 'desc' },
          select: {
            createdByUser: { select: { role: { select: { name: true } } } },
          },
        })) as { createdByUser?: { role?: { name?: unknown } } } | null;
        const confirmedBy = String(existing?.createdByUser?.role?.name || '').toLowerCase();
        if (confirmedBy) {
          throw new BadRequestError(
            `This hoarding is already Under Process (confirmed by ${confirmedBy})`,
          );
        }
        throw new BadRequestError('This hoarding is already Under Process');
      }

      // Create booking in the next state and store who confirmed.
      await unsafeTx.booking.create({
        data: {
          hoarding: { connect: { id: token.hoardingId } },
          startDate: effectiveDateFrom,
          endDate: effectiveDateTo,
          status: nextBookingStatus,
          createdByUser: { connect: { id: actorId } },
        },
      });

      await unsafeTx.bookingToken.update({
        where: { id: token.id },
        data: {
          status: 'APPROVED',
          designStatus: resolvedExecutionType === 'CLIENT_DIRECT_FLEX' ? 'COMPLETED' : 'PENDING',
          designerId: resolvedExecutionType === 'CLIENT_DIRECT_FLEX' ? null : token.designerId,
          plannedLiveDate: plannedLiveDate ? plannedLiveDate : undefined,
          dateFrom: effectiveDateFrom,
          dateTo: effectiveDateTo,
          durationMonths: durationMonthsToPersist,
          paymentPlanType: normalizedPaymentPlanType || undefined,
          billingFrequency: normalizedBillingFrequency || undefined,
          gstApplicable: gstApplicable === null ? undefined : gstApplicable,
          finalAgreedBasePrice:
            finalAgreedBasePrice === null ? undefined : new Prisma.Decimal(finalAgreedBasePrice),
          modeOfPayment: modeOfPayment || undefined,
          printingChargesBase: new Prisma.Decimal(printingChargesBase),
          mountingChargesBase: new Prisma.Decimal(mountingChargesBase),
          poRequired,
          poNotes: poNotes || null,
          expectedPoDate: expectedPoDate || undefined,
        },
      });

      // Cancel other tokens for same overlap (ACTIVE only)
      const others = (await unsafeTx.bookingToken.findMany({
        where: {
          hoardingId: token.hoardingId,
          id: { not: token.id },
          status: { in: ['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] },
          OR: [{ AND: [{ dateFrom: { lte: token.dateTo } }, { dateTo: { gte: token.dateFrom } }] }],
        },
        select: { id: true, salesUserId: true },
      })) as Array<{ id: string; salesUserId: string }>;

      if (others.length > 0) {
        await unsafeTx.bookingToken.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: {
            status: 'RELEASED',
            releasedAt: now,
            releasedById: actorId,
            releaseReason: 'approved',
          },
        });
      }

      return {
        tokenId: token.id,
        hoardingId: token.hoardingId,
        salesUserId: token.salesUserId,
        clientId: token.clientId,
        cancelledSalesUserIds: Array.from(new Set(others.map((o) => o.salesUserId))),
        executionType: resolvedExecutionType,
      };
    })) as unknown as ConfirmResult;

    if (isSalesConfirmer && result.clientId) {
      try {
        await this.clientSvc.upsertBillingProfile(result.clientId, {
          billingCompanyName: billingConfig?.billingCompanyName,
          billingPhone: billingConfig?.billingPhone,
          billingEmail: billingConfig?.billingEmail,
          gstin: billingConfig?.gstin,
          billingAddress: billingConfig?.billingAddress,
        });
      } catch (_) {
        // optional profile enrichment should not block confirmation
      }

      try {
        await this.billingEventService.syncForToken(result.tokenId);
      } catch (_) {
        // billing schedule sync should not block confirmation
      }
    }

    // Notify winning sales user
    try {
      const statusLabel = isSalesConfirmer ? 'Booked' : 'Under Process';
      await this.notification.notifyUsers(
        [result.salesUserId],
        'Token confirmed',
        `Your token was confirmed. Hoarding moved to ${statusLabel}.`,
        `/booking-tokens/${result.tokenId}`,
      );
    } catch (_) {}

    // Notify cancelled sales users
    try {
      if (result.cancelledSalesUserIds.length > 0) {
        await this.notification.notifyUsers(
          result.cancelledSalesUserIds,
          'Token cancelled',
          'Another user confirmed booking. Your token was cancelled.',
          `/hoardings/${result.hoardingId}`,
        );
      }
    } catch (_) {}

    // SSE update
    try {
      eventBus.emit('hoarding-status', {
        hoardingId: result.hoardingId,
        status: isSalesConfirmer ? 'booked' : 'under_process',
        hasActiveToken: false,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    // If manager confirmed, notify owners (non-blocking)
    try {
      if (roleLower === 'manager') {
        const owners = await this.userRepo.findByRoles(['owner']);
        const ownerIds = owners
          .map((u: User) => u.id)
          .filter((uid: string) => uid && uid !== actorId);
        if (ownerIds.length > 0) {
          const manager = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(result.hoardingId);
          const managerName = manager?.name || 'Manager';
          const hoardingCode = hoarding?.code || result.hoardingId;
          await this.notification.notifyUsers(
            ownerIds,
            'Hoarding Under Process',
            `${managerName} marked ${hoardingCode} as Under Process (via token confirmation).`,
            `/hoardings/${result.hoardingId}`,
          );
        }
      }
    } catch (_) {}

    // If sales confirmed, notify Supervisors (non-blocking)
    try {
      if (isSalesConfirmer) {
        const supervisors = await this.userRepo.findByRoles(['supervisor']);
        const recipientIds = supervisors
          .map((u: User) => u.id)
          .filter((uid: string) => uid && uid !== actorId);
        if (recipientIds.length > 0) {
          const sales = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(result.hoardingId);
          const salesName = sales?.name || 'Sales';
          const hoardingCode = hoarding?.code || result.hoardingId;
          const execLabel =
            result.executionType === 'CLIENT_DIRECT_FLEX'
              ? 'Direct flex provided by client'
              : result.executionType === 'CLIENT_CDR'
                ? 'Client provides CDR file'
                : result.executionType === 'IN_HOUSE_DESIGN'
                  ? 'In-house designing'
                  : 'Execution type not set';
          await this.notification.notifyUsers(
            recipientIds,
            'Ready for Supervisor Action',
            `${salesName} finalized ${hoardingCode}. Execution type: ${execLabel}.`,
            `/dashboard/supervisor?from=notification`,
          );
        }
      }
    } catch (_) {}
  }

  async cancelToken(id: string, actorId: string, actorRoleName?: string): Promise<void> {
    const roleLower = String(actorRoleName || '').toLowerCase();
    const canManage = ['owner', 'manager', 'admin'].includes(roleLower);
    const canSelf = roleLower === 'sales';
    if (!canManage && !canSelf) throw new ForbiddenError('Not allowed');

    const phase3Enabled = await supportsPhase3BlockingSchema();

    const tokenUnknown2 = await this.repo.findById(id);
    const token2 = tokenUnknown2 as unknown as {
      id: string;
      hoardingId: string;
      dateFrom: Date;
      dateTo: Date;
      status: string;
      expiresAt: Date;
      salesUserId: string;
    };
    if (!token2) throw new NotFoundError('Token not found');
    const stUpper = String(token2.status || '').toUpperCase();
    const releasable = phase3Enabled
      ? ['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE']
      : ['ACTIVE'];
    if (!releasable.includes(stUpper)) {
      throw new ForbiddenError('Only active/pending tokens can be released');
    }

    if (canSelf && token2.salesUserId !== actorId) {
      throw new ForbiddenError('You can only release your own token');
    }

    const now = new Date();
    const txResult = phase3Enabled
      ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.bookingToken.update({
            where: { id },
            data: {
              status: 'RELEASED',
              releasedAt: now,
              releasedById: actorId,
              releaseReason: canSelf ? 'self_released' : 'manual_unblock',
              extensionRequestedAt: null,
              extensionRequestedUntil: null,
            },
            select: { id: true },
          });

          const normalized = await this.normalizeQueueAndEnsureHeadBlocked(tx, {
            hoardingId: token2.hoardingId,
            from: token2.dateFrom,
            to: token2.dateTo,
          });
          return normalized;
        })
      : (() => {
          // Legacy DB (no blockedAt / Phase-3 enum values). Avoid Prisma update() because it
          // returns all columns and crashes when blockedAt doesn't exist.
          return prisma.$executeRaw`UPDATE "BookingToken" SET "status" = ${'RELEASED'}::text::"TokenStatus" WHERE "id" = ${id}`.then(
            () => ({
              headTokenId: null,
              headSalesUserId: null,
              headPromotedToBlocked: false,
            }),
          );
        })();

    // Notify the releasing sales user if management released it
    try {
      if (!canSelf) {
        await this.notification.notifyUsers(
          [token2.salesUserId],
          'Token released',
          'Your token was released by management.',
          `/hoardings/${token2.hoardingId}`,
        );
      }
    } catch (_) {}

    // Notify new head if it was promoted to blocked
    try {
      if (txResult.headPromotedToBlocked && txResult.headSalesUserId && txResult.headTokenId) {
        await this.notification.notifyUsers(
          [txResult.headSalesUserId],
          'Token promoted',
          'You are now first in queue and your block is active.',
          `/booking-tokens/${txResult.headTokenId}`,
        );
      }
    } catch (_) {}

    // Notify Owner + Manager when Sales self-releases (non-blocking)
    try {
      if (String(actorRoleName || '').toLowerCase() === 'sales') {
        const recipients = await this.getOwnerAndManagerIds(actorId);
        if (recipients.length > 0) {
          const salesUser = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(token2.hoardingId);
          const salesName = salesUser?.name || 'A salesperson';
          const hoardingCode = hoarding?.code || token2.hoardingId;
          await this.notification.notifyUsers(
            recipients,
            'Token released',
            `${salesName} released token for ${hoardingCode}.`,
            `/hoardings/${token2.hoardingId}`,
          );
        }
      }
    } catch (_) {}

    // Recompute hoarding status based on remaining ACTIVE tokens and bookings
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hoardingId = (token2 as any).hoardingId as string;
      const active = await this.repo.findActiveByHoarding(hoardingId);
      if ((active as unknown[]).length > 0) {
        await this.hoardingRepo.update(hoardingId, {
          status: 'tokenized',
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId,
          status: 'tokenized',
          hasActiveToken: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const bookings = await this.bookingRepo.findByHoardingId(hoardingId);
        const now = new Date();
        const activeBookings = (bookings || []).filter((b) => {
          const end = b.endDate ? new Date(b.endDate) : null;
          return !end || end >= now;
        });
        const statuses = activeBookings.map((b) =>
          String((b as unknown as { status?: unknown }).status || '').toLowerCase(),
        );
        const hasConfirmed = statuses.includes('confirmed');
        const hasUnderProcess = statuses.includes('under_process');
        const newStatus = hasConfirmed
          ? 'under_process'
          : hasUnderProcess
            ? 'under_process'
            : 'available';
        await this.hoardingRepo.update(hoardingId, {
          status: newStatus,
        } as unknown as Prisma.HoardingUpdateInput);
        eventBus.emit('hoarding-status', {
          hoardingId,
          status: newStatus,
          hasActiveToken: false,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (_) {}
  }

  async requestExtension(id: string, actor: { id: string; roleName: string }): Promise<void> {
    const phase3Enabled = await supportsPhase3BlockingSchema();
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (roleLower !== 'sales') throw new ForbiddenError('Only Sales can request extensions');

    const tokenUnknown = await this.repo.findById(id);
    const token = tokenUnknown as unknown as {
      id: string;
      hoardingId: string;
      salesUserId: string;
      status: string;
      queuePosition: number;
      expiresAt: Date;
    } | null;
    if (!token) throw new NotFoundError('Token not found');
    if (token.salesUserId !== actor.id) throw new ForbiddenError('Not allowed');

    const st = String(token.status || '').toUpperCase();
    if (st !== 'BLOCKED' && st !== 'ACTIVE') {
      throw new BadRequestError('Extension can only be requested for an active blocked token');
    }
    if (token.queuePosition !== 1)
      throw new BadRequestError('Only the first token can request extension');

    const now = new Date();
    const base = token.expiresAt && token.expiresAt > now ? token.expiresAt : now;
    const requestedUntil = new Date(base);
    requestedUntil.setHours(requestedUntil.getHours() + EXPIRY_HOURS);

    if (!phase3Enabled) {
      // Legacy mode (DB not migrated): store a pending request marker in `notes`.
      // Owner/Manager/Admin can approve/reject by reading this marker.
      const existingRequested = parseLegacyExtensionRequestedUntil(
        (tokenUnknown as unknown as { notes?: string | null } | null)?.notes ?? null,
      );
      if (existingRequested) {
        throw new BadRequestError('Extension request is already pending');
      }

      const updatedNotes = upsertLegacyExtensionMarker(
        (tokenUnknown as unknown as { notes?: string | null } | null)?.notes ?? null,
        requestedUntil,
      );
      await prisma.bookingToken.updateMany({
        where: { id },
        data: {
          notes: updatedNotes,
        },
      });
    } else {
      await prisma.bookingToken.update({
        where: { id },
        data: {
          status: 'EXTENSION_REQUESTED',
          extensionRequestedAt: now,
          extensionRequestedUntil: requestedUntil,
        },
      });
    }

    // Notify Owner + Manager (+ Admin)
    try {
      const recipients = await this.getOwnerAndManagerIds(actor.id);
      if (recipients.length > 0) {
        const hoarding = await this.hoardingRepo.findById(token.hoardingId);
        const hoardingCode = hoarding?.code || token.hoardingId;
        await this.notification.notifyUsersIdempotent(
          recipients,
          'Extension requested',
          `Extension requested for ${hoardingCode}. Requested until: ${requestedUntil.toLocaleString()}.`,
          `/booking-tokens/${id}`,
          `ext_req:${id}:${requestedUntil.toISOString()}`,
        );
      }
    } catch (_) {}
  }

  async approveExtension(id: string, actor: { id: string; roleName: string }): Promise<void> {
    const phase3Enabled = await supportsPhase3BlockingSchema();
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    if (!phase3Enabled) {
      const tokenUnknown = await this.repo.findById(id);
      const token = tokenUnknown as unknown as {
        id: string;
        salesUserId: string;
        hoardingId: string;
        notes?: string | null;
      } | null;
      if (!token) throw new NotFoundError('Token not found');

      const until = parseLegacyExtensionRequestedUntil(token.notes ?? null);
      if (!until) throw new BadRequestError('No pending extension request');

      await prisma.bookingToken.updateMany({
        where: { id },
        data: {
          expiresAt: until,
          notes: stripLegacyExtensionMarker(token.notes ?? null),
        },
      });

      try {
        await this.notification.notifyUsersIdempotent(
          [token.salesUserId],
          'Extension approved',
          `Your extension request was approved until ${until.toLocaleString()}.`,
          `/booking-tokens/${id}`,
          `ext_appr:${id}:${until.toISOString()}`,
        );
      } catch (_) {}
      return;
    }

    const now = new Date();
    const tokenUnknown = await this.repo.findById(id);
    const token = tokenUnknown as unknown as {
      id: string;
      salesUserId: string;
      status: string;
      extensionRequestedUntil?: Date | null;
    } | null;
    if (!token) throw new NotFoundError('Token not found');

    const st = String(token.status || '').toUpperCase();
    if (st !== 'EXTENSION_REQUESTED') throw new BadRequestError('No pending extension request');

    const until = token.extensionRequestedUntil ? new Date(token.extensionRequestedUntil) : null;
    if (!until || isNaN(until.getTime())) throw new BadRequestError('Invalid extension request');

    await prisma.bookingToken.update({
      where: { id },
      data: {
        status: 'BLOCKED',
        expiresAt: until,
        extensionApprovedAt: now,
        extensionApprovedById: actor.id,
      },
    });

    // Notify Sales
    try {
      await this.notification.notifyUsers(
        [token.salesUserId],
        'Extension approved',
        'Your extension request was approved.',
        `/booking-tokens/${id}`,
      );
    } catch (_) {}
  }

  async rejectExtension(id: string, actor: { id: string; roleName: string }): Promise<void> {
    const phase3Enabled = await supportsPhase3BlockingSchema();
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    if (!phase3Enabled) {
      const tokenUnknown = await this.repo.findById(id);
      const token = tokenUnknown as unknown as {
        id: string;
        salesUserId: string;
        notes?: string | null;
      } | null;
      if (!token) throw new NotFoundError('Token not found');

      const until = parseLegacyExtensionRequestedUntil(token.notes ?? null);
      if (!until) throw new BadRequestError('No pending extension request');

      await prisma.bookingToken.updateMany({
        where: { id },
        data: {
          notes: stripLegacyExtensionMarker(token.notes ?? null),
        },
      });

      try {
        await this.notification.notifyUsersIdempotent(
          [token.salesUserId],
          'Extension rejected',
          'Your extension request was rejected.',
          `/booking-tokens/${id}`,
          `ext_rej:${id}:${until.toISOString()}`,
        );
      } catch (_) {}
      return;
    }

    const tokenUnknown = await this.repo.findById(id);
    const token = tokenUnknown as unknown as {
      id: string;
      salesUserId: string;
      status: string;
    } | null;
    if (!token) throw new NotFoundError('Token not found');

    const st = String(token.status || '').toUpperCase();
    if (st !== 'EXTENSION_REQUESTED') throw new BadRequestError('No pending extension request');

    await prisma.bookingToken.update({
      where: { id },
      data: {
        status: 'BLOCKED',
        extensionRequestedAt: null,
        extensionRequestedUntil: null,
      },
    });

    // Notify Sales
    try {
      await this.notification.notifyUsers(
        [token.salesUserId],
        'Extension rejected',
        'Your extension request was rejected.',
        `/booking-tokens/${id}`,
      );
    } catch (_) {}
  }

  async listMyTokens(userId: string) {
    return this.repo.listMine(userId);
  }

  async expireAndPromote(): Promise<void> {
    const phase3Enabled = await supportsPhase3BlockingSchema();
    if (!phase3Enabled) {
      // Legacy mode: only expire ACTIVE tokens. No queue promotion.
      const now = new Date();
      const due = await this.repo.findExpiredBlocked(now);
      for (const dUnknown of due) {
        const d = dUnknown as unknown as { id?: string };
        if (!d?.id) continue;
        try {
          await prisma.bookingToken.update({
            where: { id: String(d.id) },
            data: { status: 'EXPIRED' },
          });
        } catch (_) {
          // ignore individual failures
        }
      }
      return;
    }
    const now = new Date();
    const due = await this.repo.findExpiredBlocked(now);
    type TokenHead = {
      id: string;
      hoardingId: string;
      dateFrom: Date;
      dateTo: Date;
      status: string;
      salesUserId: string;
      queuePosition: number;
    };
    for (const dUnknown of due) {
      const d = dUnknown as unknown as TokenHead;
      // Atomically expire and promote within the same transaction
      const txResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.bookingToken.findUnique({
          where: { id: d.id },
          select: { id: true, status: true, expiresAt: true },
        });
        const st = String((current as any)?.status || '').toUpperCase();
        if (!['BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'].includes(st)) {
          return {
            promoted: false,
            nextSalesUserId: null as string | null,
            nextTokenId: null as string | null,
          };
        }
        const exp = (current as any)?.expiresAt ? new Date((current as any).expiresAt) : null;
        if (exp && exp >= now) {
          return {
            promoted: false,
            nextSalesUserId: null as string | null,
            nextTokenId: null as string | null,
          };
        }

        await tx.bookingToken.update({
          where: { id: d.id },
          data: { status: 'EXPIRED' },
        });

        const normalized = await this.normalizeQueueAndEnsureHeadBlocked(tx, {
          hoardingId: d.hoardingId,
          from: d.dateFrom,
          to: d.dateTo,
        });

        return {
          promoted: normalized.headPromotedToBlocked,
          nextSalesUserId: normalized.headSalesUserId,
          nextTokenId: normalized.headTokenId,
        };
      });

      // Notify expired token owner
      try {
        await this.notification.notifyUsers(
          [d.salesUserId],
          'Token expired',
          'Your booking token expired.',
          `/hoardings/${d.hoardingId}`,
        );
      } catch (_) {}

      // Notify promoted head
      try {
        if (txResult.promoted && txResult.nextSalesUserId && txResult.nextTokenId) {
          await this.notification.notifyUsers(
            [txResult.nextSalesUserId],
            'Token promoted',
            'You are now first in queue and your block is active.',
            `/booking-tokens/${txResult.nextTokenId}`,
          );
        }
      } catch (_) {}

      // After processing, recompute hoarding status from remaining ACTIVE tokens and bookings
      try {
        const active = await this.repo.findActiveByHoarding(d.hoardingId);
        if ((active as unknown[]).length > 0) {
          await this.hoardingRepo.update(d.hoardingId, {
            status: 'tokenized',
          } as unknown as Prisma.HoardingUpdateInput);
          eventBus.emit('hoarding-status', {
            hoardingId: d.hoardingId,
            status: 'tokenized',
            hasActiveToken: true,
            updatedAt: new Date().toISOString(),
          });
        } else {
          const bookings = await this.bookingRepo.findByHoardingId(d.hoardingId);
          const now = new Date();
          const activeBookings = (bookings || []).filter((b) => {
            const end = b.endDate ? new Date(b.endDate) : null;
            return !end || end >= now;
          });
          const statuses = activeBookings.map((b) =>
            String((b as unknown as { status?: unknown }).status || '').toLowerCase(),
          );
          const hasConfirmed = statuses.includes('confirmed');
          const hasUnderProcess = statuses.includes('under_process');
          const newStatus = hasConfirmed
            ? 'under_process'
            : hasUnderProcess
              ? 'under_process'
              : 'available';
          await this.hoardingRepo.update(d.hoardingId, {
            status: newStatus,
          } as unknown as Prisma.HoardingUpdateInput);
          eventBus.emit('hoarding-status', {
            hoardingId: d.hoardingId,
            status: newStatus,
            hasActiveToken: false,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (_) {}
    }
  }

  async listAssignedToDesigner(designerId: string): Promise<unknown[]> {
    return this.repo.listAssignedToDesigner(designerId);
  }

  async listAssignedToFitter(fitterId: string): Promise<unknown[]> {
    return this.repo.listAssignedToFitter(fitterId);
  }

  async listActiveFitters(): Promise<Array<{ id: string; name: string; email?: string | null }>> {
    const fitters = await this.userRepo.findByRole('fitter');
    return (fitters || [])
      .filter((u: User) => !!u && u.isActive)
      .map((u: User) => ({ id: String(u.id), name: String(u.name || ''), email: u.email }));
  }

  async listActiveDesigners(): Promise<Array<{ id: string; name: string; email?: string | null }>> {
    const designers = await this.userRepo.findByRole('designer');
    return (designers || [])
      .filter((u: User) => !!u && u.isActive)
      .map((u: User) => ({ id: String(u.id), name: String(u.name || ''), email: u.email }));
  }

  async assignFitter(
    tokenId: string,
    actorId: string,
    actorRoleName?: string,
    fitterId?: string,
  ): Promise<void> {
    const roleLower = String(actorRoleName || '').toLowerCase();
    if (!['owner', 'manager', 'admin', 'supervisor'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const tokenUnknown = await this.repo.findById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: string;
      hoardingId: string;
      fitterId?: string | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
    };
    if (!token) throw new NotFoundError('Token not found');
    if (!['CONFIRMED', 'APPROVED'].includes(String(token.status || '').toUpperCase())) {
      throw new BadRequestError('Installation workflow is not active');
    }
    if (String(token.designStatus || 'PENDING') !== 'COMPLETED') {
      throw new BadRequestError('Design must be completed before assigning a fitter');
    }

    // Lock: fitter can be assigned only once
    if (token.fitterId) {
      throw new ConflictError('This hoarding has already been assigned by another user.');
    }

    let assignedFitterId: string | null = null;
    let assignedFitterName: string | null = null;

    if (typeof fitterId === 'string' && fitterId.trim().length > 0) {
      const fitter = await this.userRepo.findById(fitterId.trim());
      if (!fitter || !fitter.isActive) {
        throw new BadRequestError('Selected fitter is not available');
      }
      if (String(fitter.role?.name || '').toLowerCase() !== 'fitter') {
        throw new BadRequestError('Selected user is not a fitter');
      }
      assignedFitterId = fitter.id;
      assignedFitterName = fitter.name;
    } else {
      const fitters = await this.userRepo.findByRoles(['fitter']);
      const activeFitters = (fitters || []).filter((u: User) => !!u && u.isActive);
      if (activeFitters.length === 1) {
        assignedFitterId = activeFitters[0].id;
        assignedFitterName = activeFitters[0].name;
      } else if (activeFitters.length === 0) {
        throw new BadRequestError('No fitters available to assign');
      } else {
        throw new BadRequestError('Please select a fitter to assign');
      }
    }

    const now = new Date();
    // Concurrency-safe assignment: only one request wins
    const updated = await prisma.bookingToken.updateMany({
      where: { id: tokenId, fitterId: null },
      data: {
        fitterId: assignedFitterId,
        fitterStatus: 'PENDING',
        fitterAssignedAt: now,
      },
    });
    if (!updated || updated.count !== 1) {
      throw new ConflictError('This hoarding has already been assigned by another user.');
    }

    // Update hoarding workflow state (separate from availability status)
    try {
      await this.hoardingRepo.update(token.hoardingId, {
        workflowState: 'FITTER_ASSIGNED',
      } as unknown as Prisma.HoardingUpdateInput);
    } catch (_) {}

    try {
      eventBus.emit('fitter-status', {
        tokenId,
        hoardingId: token.hoardingId,
        fitterId: assignedFitterId,
        fitterStatus: 'PENDING',
        updatedAt: now.toISOString(),
      });
    } catch (_) {}

    // Notify assigned fitter with details (non-blocking)
    try {
      if (assignedFitterId) {
        const detailsUnknown = await this.repo.findDetailsById(tokenId);
        const details = detailsUnknown as {
          hoardingId?: string;
          hoarding?: {
            code?: string;
            city?: string;
            area?: string;
            landmark?: string;
            roadName?: string;
            side?: string;
            widthCm?: number;
            heightCm?: number;
          };
          client?: { name?: string; phone?: string; email?: string };
          designer?: { id?: string; name?: string };
        } | null;
        const h = details?.hoarding;
        const c = details?.client;
        const size = h?.widthCm && h?.heightCm ? `${h.widthCm}cm x ${h.heightCm}cm` : 'N/A';
        const title = 'New installation assigned';
        const body =
          `Hoarding: ${h?.code || details?.hoardingId || ''} | ${h?.city || ''} ${h?.area || ''}`.trim() +
          `\nLocation: ${h?.landmark || h?.roadName || 'N/A'} | Side: ${h?.side || 'N/A'} | Size: ${size}` +
          `\nClient: ${c?.name || 'N/A'} | ${c?.phone || ''} | ${c?.email || ''}` +
          `\nDesign: Completed${details?.designer?.name ? ` (by ${details.designer.name})` : ''}` +
          (assignedFitterName ? `\nAssigned to: ${assignedFitterName}` : '');
        // Idempotent: only one notification per hoarding + assignment type + assigned user
        const dedupeKey = `ASSIGN_FITTER:${token.hoardingId}:${assignedFitterId}`;
        await this.notification.createNotification(
          assignedFitterId,
          title,
          body,
          `/booking-tokens/${tokenId}?from=notification`,
          dedupeKey,
        );
      }
    } catch (_) {}
  }

  async completeInstallationWithProof(
    tokenId: string,
    actorId: string,
    files: Array<{ filename: string; url: string }>,
  ): Promise<void> {
    if (!files || files.length === 0) {
      throw new BadRequestError('At least one installation proof image is required');
    }

    const tokenUnknown = await this.repo.findDetailsById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: string;
      hoardingId: string;
      salesUserId: string;
      fitterId?: string | null;
      fitterStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      installationImages?: unknown;
      hoarding?: { code?: string; status?: string };
    };
    if (!token) throw new NotFoundError('Token not found');
    if (!['CONFIRMED', 'APPROVED'].includes(String(token.status || '').toUpperCase())) {
      throw new BadRequestError('Installation workflow is not active');
    }
    if (String(token.designStatus || 'PENDING') !== 'COMPLETED') {
      throw new BadRequestError('Design must be completed before installation can start');
    }
    if (!token.fitterId || String(token.fitterId) !== String(actorId)) {
      throw new ForbiddenError('Only the assigned fitter can submit installation proof');
    }
    const current = (token.fitterStatus || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    if (current !== 'IN_PROGRESS') {
      throw new BadRequestError(
        'Installation must be In Progress before it can be marked as Fitted',
      );
    }

    const now = new Date();
    const rawExisting = token.installationImages as unknown;
    const existing = Array.isArray(rawExisting) ? rawExisting : rawExisting ? [rawExisting] : [];
    const toAdd = files.map((f) => ({
      filename: f.filename,
      url: f.url,
      uploadedAt: now.toISOString(),
    }));
    const merged = [...existing, ...toAdd];

    const prismaUnsafe = prisma as unknown as {
      bookingToken: {
        update: (args: unknown) => Promise<unknown>;
      };
    };

    await prismaUnsafe.bookingToken.update({
      where: { id: tokenId },
      data: {
        installationImages: merged,
        fitterStatus: 'COMPLETED',
        fitterCompletedAt: now,
      },
    });

    // Update hoarding: installation done -> make LIVE
    try {
      await this.hoardingRepo.update(token.hoardingId, {
        status: 'live',
        workflowState: null,
      } as unknown as Prisma.HoardingUpdateInput);

      try {
        eventBus.emit('hoarding-status', {
          hoardingId: token.hoardingId,
          status: 'live',
          hasActiveToken: false,
          updatedAt: now.toISOString(),
        });
      } catch (_) {}
    } catch (_) {}

    try {
      eventBus.emit('fitter-status', {
        tokenId,
        hoardingId: token.hoardingId,
        fitterId: token.fitterId,
        fitterStatus: 'COMPLETED',
        updatedAt: now.toISOString(),
      });
    } catch (_) {}

    // Notify Owner + Manager + Sales (idempotent) with booking action
    try {
      const recipients = new Set<string>();
      (await this.getOwnerAndManagerIds(actorId)).forEach((id) => recipients.add(id));
      if (token.salesUserId) recipients.add(String(token.salesUserId));
      const recipientIds = Array.from(recipients).filter(Boolean);
      if (recipientIds.length > 0) {
        const hoardingCode = token.hoarding?.code || token.hoardingId;
        const title = 'Hoarding is Live';
        const body = `${hoardingCode} is now Live. Mark as Booked when ready.`;
        await this.notification.notifyUsersIdempotent(
          recipientIds,
          title,
          body,
          `/hoardings/${token.hoardingId}?from=notification`,
          `READY_TO_BOOK:${token.hoardingId}:${tokenId}`,
        );
      }
    } catch (_) {}
    // If no contract exists, create one from the token then activate pending contracts
    try {
      try {
        const existing = await prisma.contract.findMany({
          where: { hoardingId: token.hoardingId },
        });
        if (!existing || existing.length === 0) {
          // Build reasonable defaults from token/hoarding
          const duration = (token as any).durationMonths || (token as any).duration || 0;
          const basePrice =
            (token as any).basePrice || (token.hoarding && (token.hoarding as any).baseRate) || 0;
          const total = basePrice && duration ? basePrice * duration : basePrice || 0;
          try {
            await this.contractService.createContract(
              {
                clientId: (token as any).clientId,
                hoardingId: token.hoardingId,
                bookingId: token.id,
                durationMonths: duration,
                basePrice: basePrice,
                totalValue: total,
                paymentTerms: 'monthly',
              },
              (token as any).salesUserId || actorId || '',
            );
          } catch (_) {}
        }
      } catch (_) {}

      await this.contractService.activatePendingForHoarding(token.hoardingId, now, actorId);
    } catch (_) {}
  }

  async updateFitterStatus(tokenId: string, actorId: string, status: string): Promise<void> {
    const next = this.normalizeFitterStatus(status);

    const tokenUnknown = await this.repo.findById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: string;
      hoardingId: string;
      salesUserId?: string;
      fitterId?: string | null;
      fitterStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
      installationImages?: unknown;
    };
    if (!token) throw new NotFoundError('Token not found');
    if (!['CONFIRMED', 'APPROVED'].includes(String(token.status || '').toUpperCase())) {
      throw new BadRequestError('Installation workflow is not active');
    }
    if (String(token.designStatus || 'PENDING') !== 'COMPLETED') {
      throw new BadRequestError('Design must be completed before installation can start');
    }
    if (!token.fitterId || String(token.fitterId) !== String(actorId)) {
      throw new ForbiddenError('Only the assigned fitter can update installation status');
    }

    const current = (token.fitterStatus || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    const allowed =
      next === current ||
      (current === 'PENDING' && next === 'IN_PROGRESS') ||
      (current === 'IN_PROGRESS' && next === 'COMPLETED');
    if (!allowed) {
      throw new BadRequestError('Invalid status transition');
    }

    // Prevent completion without proof images
    if (next === 'COMPLETED' && current !== 'COMPLETED') {
      const raw = token.installationImages as unknown;
      const count = Array.isArray(raw) ? raw.length : raw ? 1 : 0;
      if (count < 1) {
        throw new BadRequestError(
          'Please upload installation proof image(s) before marking as Fitted',
        );
      }
    }

    const now = new Date();
    if (next !== current) {
      const prismaUnsafe = prisma as unknown as {
        bookingToken: {
          update: (args: unknown) => Promise<unknown>;
        };
      };
      const data: Record<string, unknown> = { fitterStatus: next };
      if (next === 'IN_PROGRESS') {
        data.fitterStartedAt = now;
      }
      if (next === 'COMPLETED') {
        data.fitterCompletedAt = now;
      }
      await prismaUnsafe.bookingToken.update({
        where: { id: tokenId },
        data,
      });
    }

    try {
      eventBus.emit('fitter-status', {
        tokenId,
        hoardingId: token.hoardingId,
        fitterId: token.fitterId,
        fitterStatus: next,
        updatedAt: now.toISOString(),
      });
    } catch (_) {}

    if (next === 'COMPLETED' && current !== 'COMPLETED') {
      try {
        // Update hoarding: installation done -> make LIVE
        try {
          await this.hoardingRepo.update(token.hoardingId, {
            status: 'live',
            workflowState: null,
          } as unknown as Prisma.HoardingUpdateInput);

          try {
            eventBus.emit('hoarding-status', {
              hoardingId: token.hoardingId,
              status: 'live',
              hasActiveToken: false,
              updatedAt: now.toISOString(),
            });
          } catch (_) {}
        } catch (_) {}

        const recipientsSet = new Set<string>();
        (await this.getOwnerAndManagerIds(actorId)).forEach((id) => recipientsSet.add(id));
        if (token.salesUserId) recipientsSet.add(String(token.salesUserId));
        const recipients = Array.from(recipientsSet).filter(Boolean);
        if (recipients.length > 0) {
          const hoarding = await this.hoardingRepo.findById(token.hoardingId);
          const hoardingCode = hoarding?.code || token.hoardingId;
          const title = 'Hoarding is Live';
          const body = `${hoardingCode} is now Live. Mark as Booked when ready.`;
          await this.notification.notifyUsersIdempotent(
            recipients,
            title,
            body,
            `/hoardings/${token.hoardingId}?from=notification`,
            `READY_TO_BOOK:${token.hoardingId}:${tokenId}`,
          );
        }
        // Activate any pending contracts for this hoarding (idempotent)
        try {
          await this.contractService.activatePendingForHoarding(token.hoardingId, now, actorId);
        } catch (_) {}
      } catch (_) {}
    }
  }

  async updateDesignStatus(tokenId: string, actorId: string, status: string): Promise<void> {
    const next = this.normalizeDesignStatus(status);

    const tokenUnknown = await this.repo.findById(tokenId);
    const token = tokenUnknown as unknown as {
      id: string;
      status: string;
      hoardingId: string;
      designerId?: string | null;
      designStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
    };
    if (!token) throw new NotFoundError('Token not found');
    if (!['CONFIRMED', 'APPROVED'].includes(String(token.status || '').toUpperCase())) {
      throw new BadRequestError('Design workflow is not active');
    }
    if (!token.designerId || String(token.designerId) !== String(actorId)) {
      throw new ForbiddenError('Only the assigned designer can update design status');
    }

    const current = (token.designStatus || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    const allowed =
      next === current ||
      (current === 'PENDING' && next === 'IN_PROGRESS') ||
      (current === 'IN_PROGRESS' && next === 'COMPLETED');
    if (!allowed) {
      throw new BadRequestError('Invalid status transition');
    }

    if (next !== current) {
      const prismaUnsafe = prisma as unknown as {
        bookingToken: {
          update: (args: unknown) => Promise<unknown>;
        };
        hoarding: {
          update: (args: unknown) => Promise<unknown>;
        };
      };
      await prismaUnsafe.bookingToken.update({
        where: { id: tokenId },
        data: { designStatus: next },
      });

      try {
        if (next === 'IN_PROGRESS') {
          await prismaUnsafe.hoarding.update({
            where: { id: token.hoardingId },
            data: { workflowState: 'DESIGN_IN_PROGRESS' },
          });
        }
        if (next === 'COMPLETED') {
          await prismaUnsafe.hoarding.update({
            where: { id: token.hoardingId },
            data: { workflowState: null },
          });
        }
      } catch (_) {}
    }

    try {
      eventBus.emit('design-status', {
        tokenId,
        hoardingId: token.hoardingId,
        designStatus: next,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    if (next === 'COMPLETED' && current !== 'COMPLETED') {
      try {
        const recipients = await this.getOwnerAndManagerIds(actorId);
        if (recipients.length > 0) {
          const designer = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(token.hoardingId);
          const designerName = designer?.name || 'Designer';
          const hoardingCode = hoarding?.code || token.hoardingId;
          await this.notification.notifyUsers(
            recipients,
            'Design completed',
            `${designerName} marked design completed for ${hoardingCode}.`,
            `/booking-tokens/${tokenId}?from=notification`,
          );
        }
        const supervisorRecipients = await this.getOwnerManagerSupervisorIds(actorId);
        if (supervisorRecipients.length > 0) {
          const designer = await this.userRepo.findById(actorId);
          const hoarding = await this.hoardingRepo.findById(token.hoardingId);
          const designerName = designer?.name || 'Designer';
          const hoardingCode = hoarding?.code || token.hoardingId;
          await this.notification.notifyUsersIdempotent(
            supervisorRecipients,
            'Design completed',
            `${designerName} marked design completed for ${hoardingCode}.`,
            `/booking-tokens/${tokenId}?from=notification`,
            `DESIGN_DONE_SUP:${tokenId}:${actorId}`,
          );
        }
      } catch (_) {}
    }
  }
}
