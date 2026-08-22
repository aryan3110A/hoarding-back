import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import type { ProposalMode } from '@prisma/client';
import { BadRequestError, ForbiddenError, NotFoundError } from '../lib/errors';
import { BlockHoardingService } from './bookingToken.service';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';

const normalizeStatus = (s: unknown) =>
  String(s || '')
    .toLowerCase()
    .trim();

interface HoardingRow {
  id: string;
  code?: string | null;
  city?: string | null;
  area?: string | null;
  landmark?: string | null;
  roadName?: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  type?: string | null;
  status?: string | null;
  standardRate?: any;
  minimumRate?: any;
  baseRate?: any;
}

type ProposalDiscountType = 'FLAT' | 'PERCENT';

type DraftHoardingInput = {
  hoardingId: string;
  discountPct?: number;
  illumination?: boolean;
  illuminationCost?: number;
  printingRate?: number;
  mountingRate?: number;
};

const toFtLabel = (widthCm?: number | null, heightCm?: number | null) => {
  if (!widthCm || !heightCm) return null;
  return `${Math.round(widthCm / 30.48)}ft x ${Math.round(heightCm / 30.48)}ft`;
};

const formatDateDMY = (date: Date) => {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
};

const indianMoney = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '0';
  const decimals = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

const toProposalFilenamePart = (value?: string | null) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const sanitized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || 'client';
};

const toProposalTimestampPart = (value?: Date | string | null) => {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}_${pad(
    safeDate.getHours(),
  )}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`;
};

const buildProposalPdfFilename = (proposal?: {
  client?: { name?: string | null; companyName?: string | null } | null;
  pdfGeneratedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) => {
  const displayName =
    String(proposal?.client?.companyName || '').trim() ||
    String(proposal?.client?.name || '').trim();
  const clientPart = toProposalFilenamePart(displayName);
  const timestampPart = toProposalTimestampPart(
    proposal?.pdfGeneratedAt || proposal?.updatedAt || proposal?.createdAt || new Date(),
  );
  return `proposal_${clientPart}_${timestampPart}.pdf`;
};

const clampPct = (v: unknown, label: string) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0 || n > 100) throw new BadRequestError(`${label} must be between 0 and 100`);
  return n;
};

const PROPOSAL_TOKEN_MARKER_RE = /\[\[PROPOSAL_ID:([^\]]+)\]\]/;
const buildProposalTokenMarker = (proposalId: string) => `[[PROPOSAL_ID:${proposalId}]]`;

const toMoney = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
};

const computeLineFinalRate = (args: {
  baseRate: number;
  discountPct: number;
  illuminationCost: number;
}) => {
  const discounted = args.baseRate * (1 - args.discountPct / 100);
  const beforeGlobal = discounted + args.illuminationCost;
  return Math.max(0, beforeGlobal);
};

const normalizeDiscountType = (value: unknown): ProposalDiscountType => {
  const v = String(value || 'PERCENT')
    .toUpperCase()
    .trim();
  return v === 'FLAT' ? 'FLAT' : 'PERCENT';
};

const clampMoney = (value: unknown) => Math.max(0, toMoney(value));

const computeDiscountAmount = (subtotal: number, type: ProposalDiscountType, value: number) => {
  const safeSubtotal = Math.max(0, subtotal);
  const safeValue = Math.max(0, value);
  if (type === 'FLAT') return Math.min(safeSubtotal, safeValue);
  const pct = Math.min(100, safeValue);
  return safeSubtotal * (pct / 100);
};

const calculateFinalRate = (args: {
  standardRate: number;
  discountType: ProposalDiscountType;
  discountValue: number;
  printingCharges: number;
  mountingCharges: number;
  includeGst: boolean;
  gstRatePct: number;
  negotiatedOverride?: number | null;
}) => {
  const start = Math.max(0, toMoney(args.standardRate));
  const discountAmount = computeDiscountAmount(start, args.discountType, args.discountValue);
  const discountedRate = Math.max(0, start - discountAmount);
  const subtotal =
    discountedRate + clampMoney(args.printingCharges) + clampMoney(args.mountingCharges);
  const gstAmount = args.includeGst ? subtotal * (clampPct(args.gstRatePct, 'GST rate') / 100) : 0;
  const gstTotal = subtotal + gstAmount;
  const negotiatedOverride =
    args.negotiatedOverride == null ? null : Math.max(0, toMoney(args.negotiatedOverride));
  const finalRate = negotiatedOverride != null ? negotiatedOverride : gstTotal;
  return {
    start,
    discountAmount,
    discountedRate,
    subtotal,
    gstAmount,
    gstTotal,
    finalRate,
  };
};

export class ProposalsService {
  private userRepository = new UserRepository();

  private getFinalizeTokenDateRange(proposalDateValue?: Date | string | null) {
    const from = proposalDateValue ? new Date(proposalDateValue) : new Date();
    const safeFrom = Number.isNaN(from.getTime()) ? new Date() : from;
    safeFrom.setHours(0, 0, 0, 0);
    const to = new Date(safeFrom);
    to.setDate(to.getDate() + 8);
    return {
      dateFrom: safeFrom.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    };
  }

  private async notifyFinalizeBlocked(input: {
    proposalId: string;
    salesUserId: string;
    hoardingIds: string[];
    tokenMetaByHoardingId?: Record<string, { tokenId: string; queuePosition: number }>;
  }) {
    if (!input.hoardingIds.length) return;
    const notification = new NotificationService();
    const [hoardings, proposal, recipients, salesUser] = await Promise.all([
      prisma.hoarding.findMany({
        where: { id: { in: input.hoardingIds } },
        select: { id: true, code: true },
      }),
      prisma.proposal.findUnique({
        where: { id: input.proposalId },
        select: {
          id: true,
          client: { select: { name: true } },
        },
      }),
      this.userRepository.findByRoles(['owner', 'manager', 'supervisor', 'admin']),
      this.userRepository.findById(input.salesUserId),
    ]);
    const codeById = new Map(
      hoardings.map((h: { id: string; code?: string | null }) => [String(h.id), h.code] as const),
    );
    const clientName = String(proposal?.client?.name || 'Client');
    const salesName = String(salesUser?.name || 'Sales User');
    const managementRecipientIds = Array.from(
      new Set<string>(
        recipients
          .map((user: { id?: string }) => String(user.id || ''))
          .filter((userId: string) => !!userId && userId !== String(input.salesUserId || '')),
      ),
    );

    await Promise.all(
      input.hoardingIds.map(async (hid) => {
        const code = codeById.get(hid) || hid;
        const tokenMeta = input.tokenMetaByHoardingId?.[hid];
        const queueText = tokenMeta?.queuePosition
          ? ` You are #${tokenMeta.queuePosition} in queue.`
          : '';
        const managementQueueText = tokenMeta?.queuePosition
          ? ` Queue #${tokenMeta.queuePosition}.`
          : '';
        const link = tokenMeta?.tokenId
          ? `/booking-tokens/${tokenMeta.tokenId}`
          : `/proposals/${input.proposalId}`;
        await Promise.all([
          notification.notifyUsersIdempotent(
            [input.salesUserId],
            'Hoarding blocked',
            `${code} blocked for Client: ${clientName}.${queueText}`,
            link,
            `proposal-finalize-block-sales:${input.proposalId}:${hid}`,
          ),
          managementRecipientIds.length > 0
            ? notification.notifyUsersIdempotent(
                managementRecipientIds,
                'Hoarding blocked',
                `${code} blocked by ${salesName} for Client: ${clientName}.${managementQueueText}`,
                link,
                `proposal-finalize-block-management:${input.proposalId}:${hid}`,
              )
            : Promise.resolve(),
        ]);
      }),
    );
  }
  private async audit(
    actorId: string | undefined,
    action: string,
    entityId?: string,
    payload?: any,
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: actorId || null,
          action,
          entityType: 'Proposal',
          entityId: entityId || null,
          payload: payload ?? null,
        },
      });
    } catch (_) {
      // non-blocking
    }
  }

  private buildDraftTokenNotes(proposalId: string, notes?: string | null) {
    const marker = buildProposalTokenMarker(proposalId);
    const base = String(notes || '').trim();
    if (!base) return marker;
    return PROPOSAL_TOKEN_MARKER_RE.test(base) ? base : `${base}\n${marker}`;
  }

  private getDraftTokenDateRange(): { dateFrom: string; dateTo: string } {
    const from = new Date();
    const to = new Date(from);
    to.setDate(from.getDate() + 1);
    const dateFrom = from.toISOString().split('T')[0];
    const dateTo = to.toISOString().split('T')[0];
    return { dateFrom, dateTo };
  }

  private async findProposalTokens(input: {
    proposalId: string;
    hoardingId: string;
    salesUserId: string;
  }) {
    const marker = buildProposalTokenMarker(input.proposalId);
    const phase3Enabled = await supportsPhase3BlockingSchema();
    const statuses = phase3Enabled
      ? (['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] as const)
      : (['ACTIVE'] as const);
    return prisma.bookingToken.findMany({
      where: {
        hoardingId: input.hoardingId,
        salesUserId: input.salesUserId,
        status: { in: statuses as any },
        notes: { contains: marker },
      },
      select: { id: true, status: true, hoardingId: true, dateFrom: true, dateTo: true },
    });
  }

  private async createDraftTokens(input: {
    proposalId: string;
    hoardingIds: string[];
    salesUserId: string;
    actorRole?: string;
    client: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      companyName?: string | null;
    };
    createdTokenIds?: string[];
  }) {
    const svc = new BlockHoardingService();
    const { dateFrom, dateTo } = this.getDraftTokenDateRange();
    for (const hoardingId of input.hoardingIds) {
      const existing = await this.findProposalTokens({
        proposalId: input.proposalId,
        hoardingId,
        salesUserId: input.salesUserId,
      });
      if (Array.isArray(existing) && existing.length > 0) continue;
      const result = await svc.createBlock({
        hoardingId,
        dateFrom,
        dateTo,
        notes: this.buildDraftTokenNotes(input.proposalId),
        client: {
          name: input.client.name || 'Unknown',
          phone: input.client.phone || '',
          email: input.client.email || undefined,
          companyName: input.client.companyName || undefined,
        },
        salesUserId: input.salesUserId,
        actorRoleName: input.actorRole,
      });
      if (result?.blockId && input.createdTokenIds) {
        input.createdTokenIds.push(String(result.blockId));
      }
    }
  }

  private async releaseDraftTokens(input: {
    proposalId: string;
    hoardingIds: string[];
    salesUserId: string;
    actorId: string;
    actorRole?: string;
  }) {
    const svc = new BlockHoardingService();
    for (const hoardingId of input.hoardingIds) {
      const tokens = await this.findProposalTokens({
        proposalId: input.proposalId,
        hoardingId,
        salesUserId: input.salesUserId,
      });
      for (const t of tokens as Array<{ id: string }>) {
        await svc.cancelToken(String(t.id), input.actorId, input.actorRole);
      }
    }
  }

  private async releaseDraftTokensForBooked(input: { hoardingIds: string[]; actorId: string }) {
    if (!input.hoardingIds.length) return;
    const phase3Enabled = await supportsPhase3BlockingSchema();
    const statuses = phase3Enabled
      ? (['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] as const)
      : (['ACTIVE'] as const);

    if (phase3Enabled) {
      await prisma.bookingToken.updateMany({
        where: {
          hoardingId: { in: input.hoardingIds },
          status: { in: statuses as any },
        },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releasedById: input.actorId,
          releaseReason: 'booked',
          extensionRequestedAt: null,
          extensionRequestedUntil: null,
        },
      });
      return;
    }

    await prisma.$executeRaw`
      UPDATE "BookingToken"
      SET "status" = ${'RELEASED'}::text::"TokenStatus"
      WHERE "hoardingId" IN (${Prisma.join(input.hoardingIds)})
        AND "status" = ANY(ARRAY[${Prisma.join(statuses as unknown as string[])}]::"TokenStatus"[])
    `;
  }

  async createDraftProposal(input: {
    client: { name: string; phone: string; email?: string; companyName?: string };
    hoardings: DraftHoardingInput[];
    salesUserId: string;
    proposalDate: string | Date;
    mode?: ProposalMode;
    discountType?: ProposalDiscountType;
    discountValue?: number;
    printingCharges?: number;
    mountingCharges?: number;
    globalDiscountPct?: number;
    includeGst?: boolean;
    gstRatePct?: number;
  }) {
    if (!input.client?.phone) throw new BadRequestError('Client phone is required');
    if (!Array.isArray(input.hoardings) || input.hoardings.length === 0) {
      throw new BadRequestError('At least one hoarding is required');
    }

    const globalDiscountPct = clampPct(input.globalDiscountPct, 'Global discount');
    const gstRatePct = clampPct(input.gstRatePct ?? 18, 'GST rate');
    const includeGst = !!input.includeGst;
    const mode: ProposalMode = input.mode || 'WITH_RATE';
    const discountType = normalizeDiscountType(input.discountType);
    const discountValue = clampMoney(input.discountValue);
    const printingCharges = clampMoney(input.printingCharges);
    const mountingCharges = clampMoney(input.mountingCharges);
    const parsedProposalDate = new Date(input.proposalDate);
    if (!input.proposalDate || Number.isNaN(parsedProposalDate.getTime())) {
      throw new BadRequestError('Proposal date is required');
    }

    // find or create client by phone
    let client = await prisma.client.findUnique({ where: { phone: input.client.phone } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: input.client.name,
          phone: input.client.phone,
          email: input.client.email || null,
          companyName: input.client.companyName || null,
          createdById: input.salesUserId,
        },
      });
    }

    const hoardingIds = input.hoardings.map((h) => h.hoardingId);
    const dbHoardings: HoardingRow[] = await prisma.hoarding.findMany({
      where: { id: { in: hoardingIds } },
      select: {
        id: true,
        code: true,
        city: true,
        area: true,
        landmark: true,
        roadName: true,
        widthCm: true,
        heightCm: true,
        type: true,
        standardRate: true,
        minimumRate: true,
        baseRate: true,
      },
    } as any);
    const byId = new Map(dbHoardings.map((h) => [h.id, h]));
    for (const hid of hoardingIds) {
      if (!byId.has(hid)) throw new NotFoundError(`Hoarding not found: ${hid}`);
    }

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const proposal = await tx.proposal.create({
        data: {
          clientId: client.id,
          salesUserId: input.salesUserId,
          proposalDate: parsedProposalDate,
          status: 'DRAFT',
          mode,
          globalDiscountPct: new Prisma.Decimal(globalDiscountPct),
          discountType: discountType as any,
          discountValue,
          printingCharges: 0,
          mountingCharges: 0,
          includeGst,
          gstRatePct: new Prisma.Decimal(gstRatePct),
        } as any,
      });

      let totalPrinting = 0;
      let totalMounting = 0;

      for (let i = 0; i < input.hoardings.length; i++) {
        const row = input.hoardings[i];
        const h = byId.get(row.hoardingId)!;
        const baseRateNum = h.standardRate
          ? Number(h.standardRate)
          : h.baseRate
            ? Number(h.baseRate)
            : 0;
        const minimumRateNum = h.minimumRate ? Number(h.minimumRate) : 0;
        const discountPct = clampPct(row.discountPct, 'Hoarding discount');
        const illuminationCost = Math.max(0, toMoney(row.illuminationCost));
        const illumination = !!row.illumination;

        const finalRate = computeLineFinalRate({
          baseRate: baseRateNum,
          discountPct,
          illuminationCost: illumination ? illuminationCost : 0,
        });

        // Compute printing & mounting charges based on SQFT
        const widthFt = h.widthCm ? Math.round(Number(h.widthCm) / 30.48) : 0;
        const heightFt = h.heightCm ? Math.round(Number(h.heightCm) / 30.48) : 0;
        const sqft = widthFt * heightFt;

        const pRate = Math.max(0, toMoney(row.printingRate ?? 0));
        const mRate = Math.max(0, toMoney(row.mountingRate ?? 0));
        const pCharges = sqft * pRate;
        const mCharges = sqft * mRate;

        totalPrinting += pCharges;
        totalMounting += mCharges;

        const rateApprovalStatus = (mode === 'WITH_RATE' && finalRate < minimumRateNum)
          ? 'PENDING_APPROVAL'
          : 'APPROVED';

        await tx.proposalHoarding.create({
          data: {
            proposalId: proposal.id,
            hoardingId: h.id,
            hoardingCode: String(h.code || ''),
            city: h.city || null,
            area: h.area || null,
            location: [h.landmark, h.roadName].filter(Boolean).join(', ') || null,
            sizeLabel: toFtLabel(h.widthCm, h.heightCm),
            type: h.type || null,
            baseRate: new Prisma.Decimal(baseRateNum),
            discountPct: new Prisma.Decimal(discountPct),
            illumination,
            illuminationCost: new Prisma.Decimal(illumination ? illuminationCost : 0),
            finalRate: new Prisma.Decimal(finalRate),
            widthCm: h.widthCm || null,
            heightCm: h.heightCm || null,
            printingRate: new Prisma.Decimal(pRate),
            mountingRate: new Prisma.Decimal(mRate),
            printingCharges: new Prisma.Decimal(pCharges),
            mountingCharges: new Prisma.Decimal(mCharges),
            rateApprovalStatus,
            orderIndex: i,
          },
        });
      }

      // Sync global printing & mounting charges as sum of line items
      await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          printingCharges: totalPrinting,
          mountingCharges: totalMounting,
        },
      });

      return tx.proposal.findUnique({
        where: { id: proposal.id },
        include: { client: true, hoardings: { orderBy: { orderIndex: 'asc' } } },
      });
    });

    await this.audit(input.salesUserId, 'proposal.create_draft', created?.id, {
      hoardings: input.hoardings.length,
      mode,
      proposalDate: parsedProposalDate.toISOString(),
      includeGst,
      discountType,
      discountValue,
      printingCharges,
      mountingCharges,
      globalDiscountPct,
      gstRatePct,
    });

    return created;
  }

  async updateDraftProposal(input: {
    proposalId: string;
    actorId: string;
    actorRole?: string;
    proposalDate?: string | Date;
    mode?: ProposalMode;
    discountType?: ProposalDiscountType;
    discountValue?: number;
    printingCharges?: number;
    mountingCharges?: number;
    globalDiscountPct?: number;
    includeGst?: boolean;
    gstRatePct?: number;
    hoardings?: DraftHoardingInput[];
  }) {
    const proposal = await prisma.proposal.findUnique({ where: { id: input.proposalId } });
    if (!proposal) throw new NotFoundError('Proposal not found');
    if ((input.actorRole || '').toLowerCase() !== 'sales') {
      throw new ForbiddenError('Only Sales can edit proposals');
    }
    if (proposal.salesUserId !== input.actorId) {
      throw new ForbiddenError('You can only edit your own proposals');
    }
    if (proposal.status !== 'DRAFT') {
      throw new ForbiddenError('Only DRAFT proposals are editable');
    }

    const globalDiscountPct = clampPct(
      input.globalDiscountPct ?? Number(proposal.globalDiscountPct),
      'Global discount',
    );
    const proposalDateRaw =
      input.proposalDate ?? (proposal as any).proposalDate ?? (proposal as any).createdAt;
    const proposalDate = new Date(proposalDateRaw as any);
    if (Number.isNaN(proposalDate.getTime())) {
      throw new BadRequestError('Proposal date is required');
    }
    const gstRatePct = clampPct(input.gstRatePct ?? Number(proposal.gstRatePct), 'GST rate');
    const includeGst = input.includeGst ?? proposal.includeGst;
    const mode = input.mode ?? proposal.mode;
    const discountType = normalizeDiscountType(
      input.discountType ?? (proposal as any).discountType ?? 'PERCENT',
    );
    const discountValue = clampMoney(input.discountValue ?? (proposal as any).discountValue ?? 0);
    const printingCharges = clampMoney(
      input.printingCharges ?? (proposal as any).printingCharges ?? 0,
    );
    const mountingCharges = clampMoney(
      input.mountingCharges ?? (proposal as any).mountingCharges ?? 0,
    );

    const hoardings = Array.isArray(input.hoardings) ? input.hoardings : null;
    if (hoardings && hoardings.length === 0) {
      throw new BadRequestError('At least one hoarding is required');
    }

    const existingRows = await prisma.proposalHoarding.findMany({
      where: { proposalId: proposal.id },
      select: { hoardingId: true },
    });
    const existingIds = existingRows
      .map((r: { hoardingId: string | null }) => String(r.hoardingId || ''))
      .filter((id: string) => !!id);

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          proposalDate,
          mode,
          globalDiscountPct: new Prisma.Decimal(globalDiscountPct),
          discountType: discountType as any,
          discountValue,
          printingCharges: 0,
          mountingCharges: 0,
          includeGst,
          gstRatePct: new Prisma.Decimal(gstRatePct),
        } as any,
      });

      if (hoardings) {
        const hoardingIds = hoardings.map((h) => h.hoardingId);
        const dbHoardings: HoardingRow[] = await tx.hoarding.findMany({
          where: { id: { in: hoardingIds } },
          select: {
            id: true,
            code: true,
            city: true,
            area: true,
            landmark: true,
            roadName: true,
            widthCm: true,
            heightCm: true,
            type: true,
            standardRate: true,
            minimumRate: true,
            baseRate: true,
          },
        } as any);
        const byId = new Map(dbHoardings.map((h) => [h.id, h]));
        for (const hid of hoardingIds) {
          if (!byId.has(hid)) throw new NotFoundError(`Hoarding not found: ${hid}`);
        }

        await tx.proposalHoarding.deleteMany({ where: { proposalId: proposal.id } });

        for (let i = 0; i < hoardings.length; i++) {
          const row = hoardings[i];
          const h = byId.get(row.hoardingId)!;
          const baseRateNum = h.standardRate
            ? Number(h.standardRate)
            : h.baseRate
              ? Number(h.baseRate)
              : 0;
          const minimumRateNum = h.minimumRate ? Number(h.minimumRate) : 0;
          const discountPct = clampPct(row.discountPct, 'Hoarding discount');
          const illuminationCost = Math.max(0, toMoney(row.illuminationCost));
          const illumination = !!row.illumination;

          const finalRate = computeLineFinalRate({
            baseRate: baseRateNum,
            discountPct,
            illuminationCost: illumination ? illuminationCost : 0,
          });

          // Compute printing & mounting charges based on SQFT
          const widthFt = h.widthCm ? Math.round(Number(h.widthCm) / 30.48) : 0;
          const heightFt = h.heightCm ? Math.round(Number(h.heightCm) / 30.48) : 0;
          const sqft = widthFt * heightFt;

          const pRate = Math.max(0, toMoney(row.printingRate ?? 0));
          const mRate = Math.max(0, toMoney(row.mountingRate ?? 0));
          const pCharges = sqft * pRate;
          const mCharges = sqft * mRate;

          let rateApprovalStatus = 'APPROVED';
          if (mode === 'WITH_RATE' && finalRate < minimumRateNum) {
            const approvedRequest = await tx.rateApprovalRequest.findFirst({
              where: {
                proposalId: proposal.id,
                hoardingId: h.id,
                status: 'APPROVED',
                proposedRate: { lte: new Prisma.Decimal(finalRate) },
              },
            });
            if (approvedRequest) {
              rateApprovalStatus = 'APPROVED';
            } else {
              rateApprovalStatus = 'PENDING_APPROVAL';
            }
          }

          await tx.proposalHoarding.create({
            data: {
              proposalId: proposal.id,
              hoardingId: h.id,
              hoardingCode: String(h.code || ''),
              city: h.city || null,
              area: h.area || null,
              location: [h.landmark, h.roadName].filter(Boolean).join(', ') || null,
              sizeLabel: toFtLabel(h.widthCm, h.heightCm),
              type: h.type || null,
              baseRate: new Prisma.Decimal(baseRateNum),
              discountPct: new Prisma.Decimal(discountPct),
              illumination,
              illuminationCost: new Prisma.Decimal(illumination ? illuminationCost : 0),
              finalRate: new Prisma.Decimal(finalRate),
              widthCm: h.widthCm || null,
              heightCm: h.heightCm || null,
              printingRate: new Prisma.Decimal(pRate),
              mountingRate: new Prisma.Decimal(mRate),
              printingCharges: new Prisma.Decimal(pCharges),
              mountingCharges: new Prisma.Decimal(mCharges),
              rateApprovalStatus,
              orderIndex: i,
            },
          });
        }
      }

      // Sync global printing & mounting charges as sum of line items
      const allHoardings = await tx.proposalHoarding.findMany({
        where: { proposalId: proposal.id },
      });
      const totalPrinting = allHoardings.reduce((sum, lh) => sum + Number(lh.printingCharges), 0);
      const totalMounting = allHoardings.reduce((sum, lh) => sum + Number(lh.mountingCharges), 0);

      await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          printingCharges: totalPrinting,
          mountingCharges: totalMounting,
        },
      });

      return tx.proposal.findUnique({
        where: { id: proposal.id },
        include: { client: true, hoardings: { orderBy: { orderIndex: 'asc' } }, salesUser: true },
      });
    });

    if (hoardings) {
      const allProposalHoardingIds = Array.from(
        new Set([
          ...existingIds,
          ...hoardings.map((h) => String(h.hoardingId || '')).filter(Boolean),
        ]),
      );
      if (allProposalHoardingIds.length > 0) {
        await this.releaseDraftTokens({
          proposalId: String(proposal.id),
          hoardingIds: allProposalHoardingIds,
          salesUserId: proposal.salesUserId,
          actorId: input.actorId,
          actorRole: input.actorRole,
        });
      }
    }

    await this.audit(input.actorId, 'proposal.update_draft', proposal.id, {
      mode,
      proposalDate: proposalDate.toISOString(),
      includeGst,
      discountType,
      discountValue,
      printingCharges,
      mountingCharges,
      globalDiscountPct,
      gstRatePct,
      hoardings: hoardings ? hoardings.length : undefined,
    });

    return updated;
  }

  private async removeUnavailableFromProposal(proposalId: string) {
    const rows = await prisma.proposalHoarding.findMany({
      where: { proposalId },
      include: { hoarding: { select: { status: true } } },
    });
    // Blocked remains proposable for other clients; only hard-exclude booked.
    const blockedIds = rows
      .filter((r: any) => {
        const st = normalizeStatus(r?.hoarding?.status);
        return st === 'booked';
      })
      .map((r: any) => String(r.id || ''))
      .filter(Boolean);
    if (blockedIds.length > 0) {
      await prisma.proposalHoarding.deleteMany({ where: { id: { in: blockedIds } } });
    }
  }

  private async buildPdfFromProposal(proposalId: string) {
    await this.removeUnavailableFromProposal(proposalId);

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        client: true,
        salesUser: true,
        hoardings: {
          orderBy: { orderIndex: 'asc' },
          include: { hoarding: true },
        },
      },
    });
    if (!proposal) throw new NotFoundError('Proposal not found');

    const hoardingIds = proposal.hoardings.map((rh: any) => rh.hoardingId).filter(Boolean) as string[];
    const dbHoardings = await prisma.hoarding.findMany({
      where: { id: { in: hoardingIds } },
      select: { id: true, minimumRate: true, code: true }
    });
    const minRateById = new Map<string, number>(dbHoardings.map((h: any) => [h.id, Number(h.minimumRate)] as const));
    const codeById = new Map<string, string | null>(dbHoardings.map((h: any) => [h.id, h.code || null] as const));

    // Enforce below-minimum rate restriction
    if (proposal.mode === 'WITH_RATE') {
      for (const r of proposal.hoardings) {
        const hid = r.hoardingId;
        if (!hid) continue;
        const minRate = minRateById.get(hid) || 0;
        const finalRate = Number(r.finalRate);
        if (finalRate < minRate) {
          const approved = await prisma.rateApprovalRequest.findFirst({
            where: {
              proposalId: proposal.id,
              hoardingId: hid,
              status: 'APPROVED',
              proposedRate: { lte: r.finalRate },
            },
          });
          if (!approved) {
            throw new ForbiddenError(
              `Rate approval is required for hoarding ${codeById.get(hid) || hid} before generating PDF.`,
            );
          }
        }
      }
    }

    const rows = proposal.hoardings || [];
    const includeGst = !!proposal.includeGst;
    const gstRatePct = clampPct((proposal as any).gstRatePct ?? 0, 'GST rate');
    const discountType = normalizeDiscountType((proposal as any).discountType ?? 'PERCENT');
    const discountValue = clampMoney((proposal as any).discountValue ?? 0);
    const printingCharges = clampMoney((proposal as any).printingCharges ?? 0);
    const mountingCharges = clampMoney((proposal as any).mountingCharges ?? 0);

    const finalSubtotal = rows.reduce(
      (sum: number, r: any) => sum + Math.max(0, toMoney(r.finalRate)),
      0,
    );
    const totals = calculateFinalRate({
      standardRate: finalSubtotal,
      discountType,
      discountValue,
      printingCharges,
      mountingCharges,
      includeGst,
      gstRatePct,
    });
    const totalsBeforeDiscount = calculateFinalRate({
      standardRate: finalSubtotal,
      discountType,
      discountValue: 0,
      printingCharges,
      mountingCharges,
      includeGst,
      gstRatePct,
    });
    const finalRateWithoutGst = totals.discountedRate;
    const gstAmount = totals.gstAmount;
    const finalRateWithGst = totals.gstTotal;
    const grandTotal = totals.finalRate;
    const grandTotalBeforeDiscount = totalsBeforeDiscount.finalRate;
    const discountAmount = totals.discountAmount;
    const hasProposalDiscount = discountValue > 0 && discountAmount > 0;

    const subtotal = finalRateWithoutGst + printingCharges + mountingCharges;

    const doc = new PDFDocument({ autoFirstPage: false });

    // Register Arial font if available to draw standard Indian Rupee symbol Unicode correctly.
    const regularFontPath = path.resolve(process.cwd(), 'assets', 'fonts', 'Arial-Regular.ttf');
    const boldFontPath = path.resolve(process.cwd(), 'assets', 'fonts', 'Arial-Bold.ttf');
    let fontReg = 'Helvetica';
    let fontBold = 'Helvetica-Bold';
    try {
      await fs.access(regularFontPath);
      await fs.access(boldFontPath);
      doc.registerFont('Arial', regularFontPath);
      doc.registerFont('Arial-Bold', boldFontPath);
      fontReg = 'Arial';
      fontBold = 'Arial-Bold';
    } catch (_) {}
    doc.font(fontReg);

    doc.addPage({ size: 'A4', margin: 48 });
    doc.fontSize(22).font(fontBold).text('Hoarding Proposal', { align: 'center' });
    doc.moveDown(0.8);

    const proposalDate = (proposal as any).proposalDate
      ? new Date((proposal as any).proposalDate)
      : new Date();

    doc.fontSize(11).font(fontReg);
    doc.text(`Proposal Date: ${formatDateDMY(proposalDate)}`);
    doc.text(`Generated At: ${new Date().toLocaleString()}`);
    doc.moveDown(0.4);
    const clientDisplayName =
      String(proposal.client?.companyName || '').trim() ||
      String(proposal.client?.name || '').trim() ||
      '—';
    doc.text(`Client: ${clientDisplayName}`);
    if (proposal.client?.email) doc.text(`Email: ${proposal.client.email}`);
    doc.moveDown(0.4);
    if (includeGst) {
      doc.text(`GST: Enabled (${gstRatePct}%)`);
    }
    if (hasProposalDiscount) {
      doc.text(`Discount: ${discountType} (${discountValue})`);
    }

    doc.moveDown(0.8);
    doc.font(fontBold).text('Financial Summary');
    doc.font(fontReg);
    doc.text(`Total Final Hoarding Rate: ₹${indianMoney(finalSubtotal)}`);
    if (hasProposalDiscount) {
      doc.text(`Proposal Discount: -₹${indianMoney(discountAmount)}`);
      doc.text(`Total Final Hoarding Rate (after discount): ₹${indianMoney(finalRateWithoutGst)}`);
    }
    doc.text(`Total Printing Charges: ₹${indianMoney(printingCharges)}`);
    doc.text(`Total Mounting Charges: ₹${indianMoney(mountingCharges)}`);
    doc.text(`Subtotal: ₹${indianMoney(subtotal)}`);
    if (includeGst) {
      doc.text(`GST @${gstRatePct}%: ₹${indianMoney(gstAmount)}`);
    } else {
      doc.text(`GST: ₹0`);
    }
    doc.moveDown(0.2);
    doc.font(fontBold).text(`Grand Total (final payable): ₹${indianMoney(grandTotal)}`);
    doc.font(fontReg);

    doc.moveDown(0.8);
    doc
      .fontSize(10)
      .fillColor('#334155')
      .text('The proposed hoardings are subject to availability.', { align: 'left' });
    doc.fillColor('#000000');

    const showRates = proposal.mode === 'WITH_RATE';
    const col = showRates
      ? {
          sn: 24,
          city: 45,
          location: 80,
          media: 45,
          w: 20,
          h: 20,
          sqft: 28,
          type: 38,
          finalRate: 50,
          printing: 50,
          mounting: 50,
          availableDate: 50,
        }
      : {
          sn: 30,
          city: 60,
          location: 130,
          media: 60,
          w: 25,
          h: 25,
          sqft: 35,
          type: 45,
          availableDate: 70,
        };

    const keys = Object.keys(col);
    const pageContentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let tableTotalWidth = keys.reduce((sum, k) => sum + (col as any)[k], 0);
    if (tableTotalWidth > pageContentWidth) {
      const scale = pageContentWidth / tableTotalWidth;
      for (const k of keys) (col as any)[k] = Math.max(26, Math.floor((col as any)[k] * scale));
      tableTotalWidth = keys.reduce((sum, k) => sum + (col as any)[k], 0);
    }

    const rowsPerPage = 10;
    const chunks: any[][] = [];
    for (let i = 0; i < rows.length; i += rowsPerPage) chunks.push(rows.slice(i, i + rowsPerPage));

    for (const pageRows of chunks.length > 0 ? chunks : [[]]) {
      doc.addPage({ size: 'A4', margin: 48 });
      const tableStartX = doc.page.margins.left;
      const headerY = doc.y;
      const headerHeight = 22;

      doc.save();
      doc.rect(tableStartX, headerY, tableTotalWidth, headerHeight).fill('#f8fafc');
      doc.fillColor('#000');
      doc.fontSize(8).font(fontBold);

      let x = tableStartX;
      doc.text('Sr. No.', x + 2, headerY + 6, { width: (col as any).sn - 4 });
      x += (col as any).sn;
      doc.text('City', x + 2, headerY + 6, { width: (col as any).city - 4 });
      x += (col as any).city;
      doc.text('Location', x + 2, headerY + 6, { width: (col as any).location - 4 });
      x += (col as any).location;
      doc.text('Media', x + 2, headerY + 6, { width: (col as any).media - 4 });
      x += (col as any).media;
      doc.text('W', x + 2, headerY + 6, { width: (col as any).w - 4 });
      x += (col as any).w;
      doc.text('H', x + 2, headerY + 6, { width: (col as any).h - 4 });
      x += (col as any).h;
      doc.text('SQFT', x + 2, headerY + 6, { width: (col as any).sqft - 4 });
      x += (col as any).sqft;
      doc.text('Type', x + 2, headerY + 6, { width: (col as any).type - 4 });
      x += (col as any).type;
      if (showRates) {
        doc.text('Final Rate Per Month (₹)', x + 2, headerY + 6, { width: (col as any).finalRate - 4, align: 'right' });
        x += (col as any).finalRate;
        doc.text('Printing Charges (₹)', x + 2, headerY + 6, { width: (col as any).printing - 4, align: 'right' });
        x += (col as any).printing;
        doc.text('Mounting Charges (₹)', x + 2, headerY + 6, { width: (col as any).mounting - 4, align: 'right' });
        x += (col as any).mounting;
      }
      doc.text('Available Date', x + 2, headerY + 6, { width: (col as any).availableDate - 4 });

      doc
        .moveTo(tableStartX, headerY + headerHeight)
        .lineTo(tableStartX + tableTotalWidth, headerY + headerHeight)
        .lineWidth(0.6)
        .strokeColor('#e2e8f0')
        .stroke();

      let y = headerY + headerHeight + 6;
      doc.fontSize(8).font(fontReg);

      if (pageRows.length === 0) {
        doc.text(
          'No hoardings available after availability re-validation.',
          tableStartX + 4,
          y + 4,
        );
        y += 20;
      }

      for (let idx = 0; idx < pageRows.length; idx++) {
        const r = pageRows[idx];
        const rowNo = String((r.orderIndex ?? idx) + 1);
        const locationText = [r.area, r.location].filter(Boolean).join(', ') || '—';

        // Compute dimension metrics
        const widthFt = r.widthCm ? Math.round(Number(r.widthCm) / 30.48) : 0;
        const heightFt = r.heightCm ? Math.round(Number(r.heightCm) / 30.48) : 0;
        const sqft = widthFt * heightFt;

        let availableDateText = 'Immediate';
        if (r.hoarding) {
          const st = normalizeStatus(r.hoarding.status);
          if (st !== 'available') {
            const exp = r.hoarding.expiryDate ? new Date(r.hoarding.expiryDate) : null;
            availableDateText = exp ? formatDateDMY(exp) : 'Immediate';
          }
        }

        const cells = showRates
          ? [
              { k: 'sn', v: rowNo },
              { k: 'city', v: r.city || '—' },
              { k: 'location', v: locationText },
              { k: 'media', v: r.type || '—' },
              { k: 'w', v: widthFt ? String(widthFt) : '0' },
              { k: 'h', v: heightFt ? String(heightFt) : '0' },
              { k: 'sqft', v: String(sqft) },
              { k: 'type', v: r.illumination ? 'Lit' : 'Non-Lit' },
              { k: 'finalRate', v: indianMoney(Number(r.finalRate)) },
              { k: 'printing', v: indianMoney(Number(r.printingCharges)) },
              { k: 'mounting', v: indianMoney(Number(r.mountingCharges)) },
              { k: 'availableDate', v: availableDateText },
            ]
          : [
              { k: 'sn', v: rowNo },
              { k: 'city', v: r.city || '—' },
              { k: 'location', v: locationText },
              { k: 'media', v: r.type || '—' },
              { k: 'w', v: widthFt ? String(widthFt) : '0' },
              { k: 'h', v: heightFt ? String(heightFt) : '0' },
              { k: 'sqft', v: String(sqft) },
              { k: 'type', v: r.illumination ? 'Lit' : 'Non-Lit' },
              { k: 'availableDate', v: availableDateText },
            ];

        const heights = cells.map((c) =>
          doc.heightOfString(String(c.v || '—'), { width: (col as any)[c.k] - 4 }),
        );
        const rowHeight = Math.max(16, Math.ceil(Math.max(...heights)) + 6);

        x = tableStartX;
        for (const c of cells) {
          const w = (col as any)[c.k];
          const align = ['finalRate', 'printing', 'mounting'].includes(c.k) ? 'right' : 'left';
          doc.text(String(c.v || '—'), x + 2, y + 3, { width: w - 4, align });
          x += w;
        }

        doc
          .moveTo(tableStartX, y + rowHeight)
          .lineTo(tableStartX + tableTotalWidth, y + rowHeight)
          .lineWidth(0.4)
          .strokeColor('#eef3f7')
          .stroke();
        y += rowHeight;
      }

      doc
        .lineWidth(0.6)
        .strokeColor('#e2e8f0')
        .rect(tableStartX, headerY, tableTotalWidth, y - headerY)
        .stroke();

      doc.moveDown(0.8);
      doc
        .fontSize(9)
        .fillColor('#334155')
        .text('The proposed hoardings are subject to availability.', tableStartX, y + 8, {
          width: tableTotalWidth,
        });
      doc.fillColor('#000000');
      doc.restore();
    }

    doc.end();
    const buffer = await getStream.buffer(doc as unknown as NodeJS.ReadableStream);
    return { buffer, proposal };
  }

  async sendProposal(input: { proposalId: string; actorId: string; actorRole?: string }) {
    const proposal = await prisma.proposal.findUnique({ where: { id: input.proposalId } });
    if (!proposal) throw new NotFoundError('Proposal not found');
    if ((input.actorRole || '').toLowerCase() !== 'sales') {
      throw new ForbiddenError('Only Sales can send proposals');
    }
    if (proposal.salesUserId !== input.actorId) {
      throw new ForbiddenError('You can only send your own proposals');
    }
    if (proposal.status !== 'DRAFT') {
      throw new ForbiddenError('Only DRAFT proposals can be sent');
    }

    const { buffer, proposal: fullProposal } = await this.buildPdfFromProposal(proposal.id);
    const pdfFilename = buildProposalPdfFilename(fullProposal as any);
    const relPath = path.posix.join('proposals', pdfFilename);
    const diskPath = path.resolve(process.cwd(), 'uploads', 'proposals', pdfFilename);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, buffer);

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        pdfPath: relPath,
        pdfGeneratedAt: new Date(),
      },
      include: { client: true, hoardings: { orderBy: { orderIndex: 'asc' } }, salesUser: true },
    });

    if (fullProposal?.hoardings?.length) {
      await this.releaseDraftTokens({
        proposalId: proposal.id,
        hoardingIds: fullProposal.hoardings
          .map((row: { hoardingId?: string | null }) => String(row.hoardingId || ''))
          .filter(Boolean),
        salesUserId: proposal.salesUserId,
        actorId: input.actorId,
        actorRole: input.actorRole,
      });
    }

    await this.audit(input.actorId, 'proposal.send', proposal.id, { pdfPath: relPath });
    return updated;
  }

  async generateAndStorePdf(input: { proposalId: string; actorId: string; actorRole?: string }) {
    const proposal = await prisma.proposal.findUnique({ where: { id: input.proposalId } });
    if (!proposal) throw new NotFoundError('Proposal not found');

    const role = (input.actorRole || '').toLowerCase();
    if (role === 'sales' && proposal.salesUserId !== input.actorId) {
      throw new ForbiddenError('You can only generate PDFs for your own proposals');
    }

    // Always rebuild from persisted proposal snapshots.
    const { buffer, proposal: fullProposal } = await this.buildPdfFromProposal(proposal.id);
    const pdfFilename = buildProposalPdfFilename(fullProposal as any);
    const relPath = path.posix.join('proposals', pdfFilename);
    const diskPath = path.resolve(process.cwd(), 'uploads', 'proposals', pdfFilename);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, buffer);

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        pdfPath: relPath,
        pdfGeneratedAt: new Date(),
      },
      include: { client: true, hoardings: { orderBy: { orderIndex: 'asc' } }, salesUser: true },
    });

    if (fullProposal?.hoardings?.length) {
      await this.releaseDraftTokens({
        proposalId: proposal.id,
        hoardingIds: fullProposal.hoardings
          .map((row: { hoardingId?: string | null }) => String(row.hoardingId || ''))
          .filter(Boolean),
        salesUserId: proposal.salesUserId,
        actorId: input.actorId,
        actorRole: input.actorRole,
      });
    }

    await this.audit(input.actorId, 'proposal.generate_pdf', proposal.id, { pdfPath: relPath });
    return updated;
  }

  async finalizeProposal(input: {
    proposalId: string;
    actorId: string;
    actorRole?: string;
    selectedHoardingIds?: string[];
    finalRates?: Record<string, number>;
  }) {
    const proposal = await prisma.proposal.findUnique({ where: { id: input.proposalId } });
    if (!proposal) throw new NotFoundError('Proposal not found');
    if ((input.actorRole || '').toLowerCase() !== 'sales') {
      throw new ForbiddenError('Only Sales can finalize proposals');
    }
    if (proposal.salesUserId !== input.actorId) {
      throw new ForbiddenError('You can only finalize your own proposals');
    }

    const normalizedStatus = normalizeStatus(proposal.status);
    const allowedStatuses = new Set(['draft', 'sent', 'partial_finalized']);
    if (normalizedStatus === 'finalized') {
      const alreadyFinalized = await prisma.proposal.findUnique({
        where: { id: proposal.id },
        include: { hoardings: { orderBy: { orderIndex: 'asc' } } },
      });
      const hoardingIds = (alreadyFinalized?.hoardings || [])
        .map((h: { hoardingId?: string | null }) => String(h.hoardingId || ''))
        .filter(Boolean);
      await this.notifyFinalizeBlocked({
        proposalId: proposal.id,
        salesUserId: proposal.salesUserId,
        hoardingIds,
      });
      return proposal;
    }
    if (!allowedStatuses.has(normalizedStatus)) {
      throw new ForbiddenError('This proposal cannot be finalized');
    }

    const full = await prisma.proposal.findUnique({
      where: { id: proposal.id },
      include: {
        client: true,
        hoardings: { orderBy: { orderIndex: 'asc' } },
      },
    });
    if (!full) throw new NotFoundError('Proposal not found');

    const allHoardingIds = (full.hoardings || [])
      .map((h: { hoardingId?: string | null }) => String(h.hoardingId || ''))
      .filter(Boolean);
    if (allHoardingIds.length === 0) {
      throw new BadRequestError('This proposal has no hoardings to finalize');
    }

    const selected = Array.isArray(input.selectedHoardingIds)
      ? Array.from(new Set(input.selectedHoardingIds.map((x) => String(x || '')).filter(Boolean)))
      : allHoardingIds;
    const selectedInProposal = selected.filter((id: string) => allHoardingIds.includes(id));
    if (selectedInProposal.length === 0) {
      throw new BadRequestError('Select at least one hoarding to finalize');
    }

    const now = new Date();
    const blockService = new BlockHoardingService();
    const createdTokenIds: string[] = [];
    const tokenMetaByHoardingId: Record<string, { tokenId: string; queuePosition: number }> = {};
    const finalizeDateRange = this.getFinalizeTokenDateRange((full as any).proposalDate);

    for (const hid of selectedInProposal) {
      const existingTokens = await this.findProposalTokens({
        proposalId: proposal.id,
        hoardingId: hid,
        salesUserId: proposal.salesUserId,
      });

      if (existingTokens.length > 0) {
        const existing = await prisma.bookingToken.findUnique({
          where: { id: String(existingTokens[0].id) },
          select: { id: true, queuePosition: true },
        });
        if (existing?.id) {
          tokenMetaByHoardingId[hid] = {
            tokenId: String(existing.id),
            queuePosition: Number(existing.queuePosition || 0),
          };
          continue;
        }
      }

      const createdToken = await blockService.createBlock({
        hoardingId: hid,
        dateFrom: finalizeDateRange.dateFrom,
        dateTo: finalizeDateRange.dateTo,
        notes: this.buildDraftTokenNotes(proposal.id),
        client: {
          name: full.client?.name || 'Client',
          phone: full.client?.phone || '',
          email: full.client?.email || undefined,
          companyName: full.client?.companyName || undefined,
        },
        salesUserId: proposal.salesUserId,
        actorRoleName: input.actorRole,
      });

      createdTokenIds.push(String(createdToken.blockId));
      tokenMetaByHoardingId[hid] = {
        tokenId: String(createdToken.blockId),
        queuePosition: Number(createdToken.queuePosition || 0),
      };
    }

    let updated;
    try {
      updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const hoardingRows = await tx.hoarding.findMany({
          where: { id: { in: selectedInProposal } },
          select: { id: true, status: true, code: true, minimumRate: true },
        } as any);

        const proposalRows = await tx.proposalHoarding.findMany({
          where: { proposalId: proposal.id, hoardingId: { in: selectedInProposal } },
          select: { hoardingId: true, finalRate: true },
        });
        const lineFinalRateByHoardingId = new Map(
          proposalRows
            .map((r) => [String(r.hoardingId || ''), toMoney(r.finalRate)] as const)
            .filter(([hid]) => !!hid),
        );

        const byId = new Map(hoardingRows.map((h) => [h.id, h]));
        const ratePatchInput = input.finalRates || {};
        for (const hid of selectedInProposal) {
          const row = byId.get(hid);
          if (!row) throw new NotFoundError(`Hoarding not found: ${hid}`);
          const st = normalizeStatus(row.status);
          if (st === 'booked') {
            throw new BadRequestError(`Hoarding already booked: ${row.code || hid}`);
          }
          if (st === 'live' || st === 'under_process') {
            throw new BadRequestError(`Hoarding cannot be finalized: ${row.code || hid}`);
          }

          const minimumRate = Math.max(0, toMoney((row as any).minimumRate));
          const negotiated = (ratePatchInput as Record<string, unknown>)[hid];
          const hasNegotiated = negotiated != null && Number.isFinite(Number(negotiated));
          const effectiveFinal = hasNegotiated
            ? Math.max(0, Number(negotiated))
            : Math.max(0, toMoney(lineFinalRateByHoardingId.get(hid) || 0));
          if (effectiveFinal < minimumRate) {
            const approved = await tx.rateApprovalRequest.findFirst({
              where: {
                proposalId: proposal.id,
                hoardingId: hid,
                status: 'APPROVED',
                proposedRate: { lte: new Prisma.Decimal(effectiveFinal) },
              },
            });
            if (!approved) {
              throw new ForbiddenError(
                `Rate approval is required for hoarding ${row.code || hid} before finalizing.`,
              );
            }
          }
        }

        const ratePatches = Object.entries(ratePatchInput)
          .map(([hid, value]) => [String(hid || ''), Number(value)] as const)
          .filter(
            ([hid, value]) =>
              selectedInProposal.includes(hid) && Number.isFinite(value) && value >= 0,
          );

        for (const [hid, value] of ratePatches) {
          await tx.proposalHoarding.updateMany({
            where: { proposalId: proposal.id, hoardingId: hid },
            data: { finalRate: new Prisma.Decimal(value) },
          });
        }

        // Mark hoardings as blocked (not booked).
        await tx.hoarding.updateMany({
          where: { id: { in: selectedInProposal } },
          data: {
            status: 'blocked',
          },
        });

        const rowsAfterUpdate = await tx.proposalHoarding.findMany({
          where: { proposalId: proposal.id },
          select: {
            hoarding: {
              select: { status: true },
            },
          },
        });
        const isFullyFinalized = rowsAfterUpdate.every((row) => {
          const st = normalizeStatus(row?.hoarding?.status);
          return st === 'blocked' || st === 'booked' || st === 'live';
        });
        const nextStatus = isFullyFinalized ? 'FINALIZED' : 'PARTIAL_FINALIZED';

        return tx.proposal.update({
          where: { id: proposal.id },
          data: { status: nextStatus as any, finalizedAt: now },
          include: {
            client: true,
            hoardings: { orderBy: { orderIndex: 'asc' } },
            salesUser: true,
          },
        });
      });
    } catch (error) {
      for (const tokenId of createdTokenIds) {
        try {
          await blockService.cancelToken(
            String(tokenId),
            input.actorId,
            input.actorRole || 'sales',
          );
        } catch (_) {}
      }
      throw error;
    }

    await this.notifyFinalizeBlocked({
      proposalId: proposal.id,
      salesUserId: proposal.salesUserId,
      hoardingIds: selectedInProposal,
      tokenMetaByHoardingId,
    });

    await this.audit(input.actorId, 'proposal.finalize_selective', proposal.id, {
      selectedHoardings: selectedInProposal.length,
      totalHoardings: allHoardingIds.length,
      negotiatedFinalRates: input.finalRates || null,
    });
    return updated;
  }

  async generateProposalPdf(opts: {
    proposalId?: string;
    hoardingIds?: string[];
    client?: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      companyName?: string | null;
      address?: string | null;
    };
    actorId?: string;
  }): Promise<Buffer> {
    if (opts.proposalId) {
      const { buffer } = await this.buildPdfFromProposal(opts.proposalId);
      return buffer;
    }

    // Legacy ad-hoc PDF generation (no persistence)
    const hoardingIds = opts.hoardingIds || [];
    if (!Array.isArray(hoardingIds) || hoardingIds.length === 0) {
      throw new BadRequestError('No hoardings provided');
    }
    const { client } = opts;

    const hoardings: HoardingRow[] = await prisma.hoarding.findMany({
      where: { id: { in: hoardingIds } },
      select: {
        id: true,
        code: true,
        city: true,
        area: true,
        landmark: true,
        roadName: true,
        widthCm: true,
        heightCm: true,
        type: true,
        status: true,
      },
    });

    const doc = new PDFDocument({ autoFirstPage: false });
    doc.addPage({ size: 'A4', margin: 48 });
    doc.fontSize(22).text('Hoarding Proposal', { align: 'center' });
    doc.moveDown(1.5);
    if (client) {
      const clientDisplayName =
        String(client.companyName || '').trim() ||
        String(client.name || '').trim() ||
        '—';
      doc.fontSize(12).text(`Client Name: ${clientDisplayName}`);
      doc.moveDown(0.2);
      if (client.phone) doc.text(`Phone: ${client.phone}`);
      if (client.email) doc.text(`Email: ${client.email}`);
      if (client.address) doc.text(`Address: ${client.address}`);
    }
    doc.moveDown(1);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);

    const rowsPerPage = 10;
    const colWidths: Record<string, number> = {
      code: 100,
      city: 110,
      location: 230,
      size: 70,
      type: 70,
      status: 90,
    };
    const pageContentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let tableTotalWidth = Object.values(colWidths).reduce((a: number, b: number) => a + b, 0);
    if (tableTotalWidth > pageContentWidth) {
      const scale = pageContentWidth / tableTotalWidth;
      Object.keys(colWidths).forEach((k) => {
        colWidths[k] = Math.floor(colWidths[k] * scale);
      });
      tableTotalWidth = Object.values(colWidths).reduce((a: number, b: number) => a + b, 0);
    }
    const chunks: HoardingRow[][] = [];
    for (let i = 0; i < hoardings.length; i += rowsPerPage)
      chunks.push(hoardings.slice(i, i + rowsPerPage));

    for (const pageRows of chunks) {
      doc.addPage({ size: 'A4', margin: 48 });

      const tableStartX = doc.page.margins.left;
      const headerY = doc.y;
      const headerHeight = Math.max(
        20,
        doc.heightOfString('Location / Area', { width: colWidths.location - 12 }) + 12,
      );

      doc.save();
      doc.rect(tableStartX, headerY, tableTotalWidth, headerHeight).fill('#f8fafc');
      doc.fillColor('#000');
      doc.fontSize(11).font('Helvetica-Bold');

      let curX = tableStartX;
      doc.text('Code', curX + 6, headerY + 6, { width: colWidths.code - 12 });
      curX += colWidths.code;
      doc.text('City', curX + 6, headerY + 6, { width: colWidths.city - 12 });
      curX += colWidths.city;
      doc.text('Location / Area', curX + 6, headerY + 6, { width: colWidths.location - 12 });
      curX += colWidths.location;
      doc.text('Size', curX + 6, headerY + 6, { width: colWidths.size - 12 });
      curX += colWidths.size;
      doc.text('Type', curX + 6, headerY + 6, { width: colWidths.type - 12 });
      curX += colWidths.type;
      doc.text('Status', curX + 6, headerY + 6, { width: colWidths.status - 12 });

      doc
        .moveTo(tableStartX, headerY + headerHeight)
        .lineTo(tableStartX + tableTotalWidth, headerY + headerHeight)
        .lineWidth(0.6)
        .strokeColor('#e2e8f0')
        .stroke();

      let currentY = headerY + headerHeight + 6;
      doc.fontSize(10).font('Helvetica');

      for (const h of pageRows) {
        const sizeText =
          h.widthCm && h.heightCm
            ? `${Math.round(h.widthCm / 30.48)}ft x ${Math.round(h.heightCm / 30.48)}ft`
            : '—';
        const locationText = [h.city, h.area, h.landmark, h.roadName].filter(Boolean).join(', ');
        const heights: number[] = [];
        heights.push(doc.heightOfString(h.code || '—', { width: colWidths.code - 12 }));
        heights.push(doc.heightOfString(h.city || '—', { width: colWidths.city - 12 }));
        heights.push(doc.heightOfString(locationText || '—', { width: colWidths.location - 12 }));
        heights.push(doc.heightOfString(sizeText, { width: colWidths.size - 12 }));
        heights.push(doc.heightOfString(h.type || '—', { width: colWidths.type - 12 }));
        heights.push(doc.heightOfString(h.status || '—', { width: colWidths.status - 12 }));

        const contentHeight = Math.max(...heights);
        const rowHeight = Math.max(18, Math.ceil(contentHeight) + 8);

        curX = tableStartX;
        doc.fillColor('#000');
        doc.text(h.code || '—', curX + 6, currentY + 4, { width: colWidths.code - 12 });
        curX += colWidths.code;
        doc.text(h.city || '—', curX + 6, currentY + 4, { width: colWidths.city - 12 });
        curX += colWidths.city;
        doc.text(locationText || '—', curX + 6, currentY + 4, { width: colWidths.location - 12 });
        curX += colWidths.location;
        doc.text(sizeText, curX + 6, currentY + 4, { width: colWidths.size - 12 });
        curX += colWidths.size;
        doc.text(h.type || '—', curX + 6, currentY + 4, { width: colWidths.type - 12 });
        curX += colWidths.type;
        doc.text(h.status || '—', curX + 6, currentY + 4, { width: colWidths.status - 12 });

        doc
          .moveTo(tableStartX, currentY + rowHeight)
          .lineTo(tableStartX + tableTotalWidth, currentY + rowHeight)
          .lineWidth(0.4)
          .strokeColor('#eef3f7')
          .stroke();
        currentY += rowHeight;
      }

      const tableHeight = currentY - headerY;
      doc
        .lineWidth(0.6)
        .strokeColor('#e2e8f0')
        .rect(tableStartX, headerY, tableTotalWidth, tableHeight)
        .stroke();
      doc.restore();
    }

    doc.end();
    const buffer = await getStream.buffer(doc as unknown as NodeJS.ReadableStream);
    return buffer;
  }

  async listProposals(filter?: { salesUserId?: string }) {
    const where: Prisma.ProposalWhereInput = {};
    if (filter?.salesUserId) where.salesUserId = filter.salesUserId;
    return prisma.proposal.findMany({
      where,
      include: {
        client: true,
        _count: { select: { hoardings: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProposalById(id: string) {
    return prisma.proposal.findUnique({
      where: { id },
      include: {
        client: true,
        hoardings: { orderBy: { orderIndex: 'asc' }, include: { hoarding: true } },
        salesUser: true,
      },
    });
  }

  async requestRateApproval(input: {
    proposalId: string;
    hoardingId: string;
    proposedRate: number;
    reason: string;
    remarks?: string;
    requestedById: string;
  }) {
    const req = await prisma.rateApprovalRequest.create({
      data: {
        proposalId: input.proposalId,
        hoardingId: input.hoardingId,
        proposedRate: new Prisma.Decimal(input.proposedRate),
        reason: input.reason,
        remarks: input.remarks || null,
        requestedById: input.requestedById,
        status: 'PENDING',
      },
    });

    await prisma.proposalHoarding.updateMany({
      where: {
        proposalId: input.proposalId,
        hoardingId: input.hoardingId,
      },
      data: {
        rateApprovalStatus: 'PENDING_APPROVAL',
      },
    });

    const recipients = await this.userRepository.findByRoles(['owner', 'manager', 'admin']);
    const recipientIds = recipients.map((u: any) => u.id).filter(Boolean) as string[];
    const salesUser = await this.userRepository.findById(input.requestedById);
    const hoarding = await prisma.hoarding.findUnique({ where: { id: input.hoardingId } });
    const client = await prisma.proposal.findUnique({
      where: { id: input.proposalId },
      select: { client: { select: { name: true } } },
    });

    const notifySvc = new NotificationService();
    if (recipientIds.length > 0) {
      await notifySvc.notifyUsersIdempotent(
        recipientIds,
        'Rate Approval Requested',
        `${salesUser?.name || 'Sales'} requested approval for below-minimum rate on hoarding ${hoarding?.code || input.hoardingId} (Client: ${client?.client?.name || 'Client'}).`,
        `/proposals/${input.proposalId}?requestId=${req.id}`,
        `rate-approval-request:${req.id}`,
      );
    }

    return req;
  }

  async listPendingRateApprovals() {
    return prisma.rateApprovalRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        proposal: { include: { client: true } },
        hoarding: true,
        requestedBy: true,
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async approveRateApproval(requestId: string, approvedById: string, remarks?: string) {
    const req = await prisma.rateApprovalRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundError('Rate approval request not found');

    const updatedRequest = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const request = await tx.rateApprovalRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          approvedById,
          approvedAt: new Date(),
          approverRemarks: remarks || null,
        },
      });

      await tx.proposalHoarding.updateMany({
        where: {
          proposalId: req.proposalId,
          hoardingId: req.hoardingId,
        },
        data: {
          finalRate: req.proposedRate,
          rateApprovalStatus: 'APPROVED',
        },
      });

      const allHoardings = await tx.proposalHoarding.findMany({
        where: { proposalId: req.proposalId },
      });
      const totalPrinting = allHoardings.reduce((sum: number, h: any) => sum + Number(h.printingCharges), 0);
      const totalMounting = allHoardings.reduce((sum: number, h: any) => sum + Number(h.mountingCharges), 0);
      const finalSubtotal = allHoardings.reduce((sum: number, h: any) => sum + Number(h.finalRate), 0);

      const prop = await tx.proposal.findUnique({ where: { id: req.proposalId } });
      if (prop) {
        const discountType = normalizeDiscountType(prop.discountType);
        const discountValue = Number(prop.discountValue);
        const totals = calculateFinalRate({
          standardRate: finalSubtotal,
          discountType,
          discountValue,
          printingCharges: totalPrinting,
          mountingCharges: totalMounting,
          includeGst: prop.includeGst,
          gstRatePct: Number(prop.gstRatePct),
        });

        await tx.proposal.update({
          where: { id: req.proposalId },
          data: {
            printingCharges: totalPrinting,
            mountingCharges: totalMounting,
          },
        });
      }

      return request;
    });

    const notifySvc = new NotificationService();
    await notifySvc.notifyUsersIdempotent(
      [req.requestedById],
      'Rate Approval Approved',
      `Your request for hoarding rate on proposal was approved.`,
      `/proposals/${req.proposalId}`,
      `rate-approval-approved:${requestId}`,
    );

    return updatedRequest;
  }

  async rejectRateApproval(requestId: string, approvedById: string, remarks?: string) {
    const req = await prisma.rateApprovalRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundError('Rate approval request not found');

    const updatedRequest = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const request = await tx.rateApprovalRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          approvedById,
          approvedAt: new Date(),
          rejectionReason: remarks || null,
        },
      });

      await tx.proposalHoarding.updateMany({
        where: {
          proposalId: req.proposalId,
          hoardingId: req.hoardingId,
        },
        data: {
          rateApprovalStatus: 'REJECTED',
        },
      });

      return request;
    });

    const notifySvc = new NotificationService();
    await notifySvc.notifyUsersIdempotent(
      [req.requestedById],
      'Rate Approval Rejected',
      `Your request for hoarding rate on proposal was rejected: ${remarks || 'No reason specified'}`,
      `/proposals/${req.proposalId}`,
      `rate-approval-rejected:${requestId}`,
    );

    return updatedRequest;
  }
}
