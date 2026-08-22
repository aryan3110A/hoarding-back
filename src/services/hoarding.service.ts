import { HoardingRepository } from '../repositories/hoarding.repository';
import { BookingRepository } from '../repositories/booking.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotificationService } from './notification.service';
import { ContractService } from './contract.service';
import { Prisma } from '@prisma/client';
import { eventBus } from '../lib/eventBus';
import { prisma } from '../lib/prisma';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from '../lib/errors';

const hoardingRepository = new HoardingRepository();
const bookingRepository = new BookingRepository();
const userRepository = new UserRepository();
const notificationService = new NotificationService();
const contractService = new ContractService();
const PROPOSAL_TOKEN_MARKER_RE = /\[\[PROPOSAL_ID:([^\]]+)\]\]/;

export interface GetAllParams {
  page?: string;
  limit?: string;
  city?: string;
  area?: string;
  landmark?: string;
  location?: string;
  type?: string;
  size?: string;
  availability?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  ownership?: string;
  categoryId?: string;
}

export class HoardingService {
  private async getLatestCampaignMetaByHoardingIds(hoardingIds: string[]) {
    const ids = Array.from(
      new Set(hoardingIds.map((id) => String(id || '').trim()).filter(Boolean)),
    );
    const metaByHoardingId = new Map<
      string,
      {
        plannedLiveDate: Date | null;
        dateFrom: Date | null;
        dateTo: Date | null;
        durationMonths: number | null;
        salesUserId: string | null;
        salesUserName: string | null;
      }
    >();

    if (ids.length === 0) return metaByHoardingId;

    const tokens = await prisma.bookingToken.findMany({
      where: {
        hoardingId: { in: ids },
        status: { in: ['CONFIRMED', 'APPROVED', 'ACTIVE'] },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        hoardingId: true,
        plannedLiveDate: true,
        dateFrom: true,
        dateTo: true,
        durationMonths: true,
        salesUserId: true,
        salesUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    for (const token of tokens) {
      const hoardingId = String(token.hoardingId || '');
      if (!hoardingId || metaByHoardingId.has(hoardingId)) continue;

      metaByHoardingId.set(hoardingId, {
        plannedLiveDate: token.plannedLiveDate || null,
        dateFrom: token.dateFrom || null,
        dateTo: token.dateTo || null,
        durationMonths: typeof token.durationMonths === 'number' ? token.durationMonths : null,
        salesUserId: token.salesUserId ? String(token.salesUserId) : null,
        salesUserName:
          String(token.salesUser?.name || '').trim() ||
          String(token.salesUser?.email || '').trim() ||
          null,
      });
    }

    return metaByHoardingId;
  }

  private attachCampaignMeta<T extends Record<string, unknown> & { id?: string }>(
    row: T,
    campaignMetaByHoardingId: Map<
      string,
      {
        plannedLiveDate: Date | null;
        dateFrom: Date | null;
        dateTo: Date | null;
        durationMonths: number | null;
        salesUserId: string | null;
        salesUserName: string | null;
      }
    >,
  ) {
    const hoardingId = String(row.id || '').trim();
    if (!hoardingId) return row;

    const campaign = campaignMetaByHoardingId.get(hoardingId);
    const liveDate =
      (row.actualLiveDate as Date | string | null | undefined) ||
      campaign?.plannedLiveDate ||
      campaign?.dateFrom ||
      null;
    const endDate =
      (row.expiryDate as Date | string | null | undefined) || campaign?.dateTo || null;

    return Object.assign(row, {
      campaignMonths: campaign?.durationMonths ?? null,
      liveDate,
      endDate,
      soldById: campaign?.salesUserId || null,
      soldByName: campaign?.salesUserName || null,
    });
  }

  private parseMoneyDecimal(value: unknown, fieldName: string): Prisma.Decimal {
    if (value === null || typeof value === 'undefined' || value === '') {
      throw new BadRequestError(`${fieldName} must be a valid number`);
    }

    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(value as any);
    } catch {
      throw new BadRequestError(`${fieldName} must be a valid number`);
    }

    if (!decimal.isFinite()) {
      throw new BadRequestError(`${fieldName} must be a valid number`);
    }
    if (decimal.isNegative()) {
      throw new BadRequestError(`${fieldName} cannot be negative`);
    }

    return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private sanitizeRateHistory(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = { ...(value as Record<string, unknown>) };
    delete record.landlord;
    delete record.landlordName;
    delete record.landlordPhone;
    delete record.landlordEmail;
    delete record.ownerPhone;
    delete record.ownerEmail;
    return record;
  }

  private async ensureLandlordExists(landlordIdRaw: unknown) {
    const landlordId = String(landlordIdRaw || '').trim();
    if (!landlordId) {
      throw new BadRequestError('landlordId is required');
    }

    const landlord = await prisma.landlord.findUnique({
      where: { id: landlordId },
      select: { id: true },
    });

    if (!landlord) {
      throw new BadRequestError('Invalid landlord selected');
    }

    return landlordId;
  }

  private addMonthsFrom(base: Date, months: number): Date {
    const next = new Date(base);
    const day = next.getDate();
    next.setMonth(next.getMonth() + months);
    if (next.getDate() < day) next.setDate(0);
    return next;
  }

  private async getUsersByRoles(roleNames: string[], excludeUserId?: string): Promise<string[]> {
    const users = await userRepository.findByRoles(roleNames);
    return Array.from(
      new Set(
        users
          .map((u: { id?: string }) => String(u.id || ''))
          .filter((id: string) => !!id && id !== String(excludeUserId || '')),
      ),
    );
  }

  private async isLiveOrActiveContract(hoardingId: string): Promise<boolean> {
    const current = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { status: true },
    });
    const hoardingStatus = String(current?.status || '').toLowerCase();
    if (hoardingStatus === 'live') return true;

    const activeContract = await prisma.contract.findFirst({
      where: {
        hoardingId,
        status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
      },
      select: { id: true },
    });
    return !!activeContract;
  }

  async generateNextSACode() {
    const rows = await prisma.hoarding.findMany({
      where: {
        OR: [
          { code: { startsWith: 'SA - ' } },
          { code: { startsWith: 'SA-' } },
          { code: { startsWith: 'sa - ' } },
          { code: { startsWith: 'sa-' } },
        ],
      },
      select: { code: true },
    });

    let maxNum = 0;
    for (const row of rows) {
      const match = String(row.code || '').match(/^SA\s*-\s*(\d+)$/i);
      if (!match) continue;
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }

    const next = maxNum + 1;
    return `SA - ${String(next).padStart(3, '0')}`;
  }

  async create(data: Prisma.HoardingCreateInput) {
    const incoming = (data || {}) as Prisma.HoardingCreateInput & {
      standardRate?: unknown;
      minimumRate?: unknown;
      baseRate?: unknown;
      landlordId?: unknown;
    };
    const standardRateRaw =
      incoming.standardRate ?? incoming.baseRate ?? (incoming as any)?.baseRate ?? 0;
    const minimumRateRaw = incoming.minimumRate ?? standardRateRaw;
    const standardRate = this.parseMoneyDecimal(standardRateRaw, 'standardRate');
    const minimumRate = this.parseMoneyDecimal(minimumRateRaw, 'minimumRate');
    if (minimumRate.gt(standardRate)) {
      throw new BadRequestError('minimumRate cannot be greater than standardRate');
    }

    const categoryId = String((incoming as any).categoryId || '').trim();
    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category) throw new BadRequestError('Invalid category selected');
    }

    const landlordId = await this.ensureLandlordExists((incoming as any).landlordId);

    const sanitizedRateHistory = this.sanitizeRateHistory((incoming as any).rateHistory);

    let code = String((incoming as any).code || '').trim();
    if (!code) {
      code = await this.generateNextSACode();
    } else {
      // Normalize SA format if user typed similar value
      const saMatch = code.match(/^SA\s*-\s*(\d+)$/i);
      if (saMatch) {
        code = `SA - ${String(parseInt(saMatch[1], 10)).padStart(3, '0')}`;
      }
      const existing = await prisma.hoarding.findFirst({
        where: { code: { equals: code, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestError(`Hoarding code "${code}" already exists. Please use a unique code.`);
      }
    }

    const finalData: Prisma.HoardingCreateInput = {
      ...incoming,
      code,
      landlordId,
      rateHistory: sanitizedRateHistory as any,
      standardRate,
      minimumRate,
      // Keep legacy field in sync for backward compatibility.
      baseRate: standardRate,
    } as any;

    delete (finalData as any).landlord;

    // Retry once if unique collision on auto-code
    let created;
    try {
      created = await hoardingRepository.create(finalData);
    } catch (err: any) {
      if (String(err?.code || '') === 'P2002' && !String((incoming as any).code || '').trim()) {
        finalData.code = await this.generateNextSACode();
        created = await hoardingRepository.create(finalData);
      } else {
        throw err;
      }
    }
    // Notify managers when an owner creates a hoarding/property
    try {
      if (process.env.NODE_ENV === 'test') return created;
      const managers = await userRepository.findByRole('manager');
      const managerIds = managers.map((m: any) => m.id);
      const title = 'New Property Created';
      const body = `A new property/hoarding (${created.code}) was created${created.city ? ` in ${created.city}` : ''}.`;
      const link = `/hoardings/${created.id}`;
      await notificationService.notifyUsers(managerIds, title, body, link);
    } catch (e) {
      // Do not block creation on notification failure
      // eslint-disable-next-line no-console
      console.error('Failed to notify managers on create:', e);
    }
    return created;
  }

  async update(id: string, data: Prisma.HoardingUpdateInput) {
    const existing = await hoardingRepository.findById(id);
    if (!existing) throw new NotFoundError('Hoarding not found');

    const incoming = (data || {}) as Prisma.HoardingUpdateInput & {
      standardRate?: unknown;
      minimumRate?: unknown;
      baseRate?: unknown;
      landlordId?: unknown;
    };

    const nextStandard =
      incoming.standardRate ??
      incoming.baseRate ??
      (existing as any).standardRate ??
      existing.baseRate ??
      0;
    const nextMinimum = incoming.minimumRate ?? (existing as any).minimumRate ?? nextStandard;

    const standardRate = this.parseMoneyDecimal(nextStandard, 'standardRate');
    const minimumRate = this.parseMoneyDecimal(nextMinimum, 'minimumRate');
    if (minimumRate.gt(standardRate)) {
      throw new BadRequestError('minimumRate cannot be greater than standardRate');
    }

    const nextCategoryIdRaw = (incoming as any).categoryId;
    const nextCategoryId =
      nextCategoryIdRaw === null || typeof nextCategoryIdRaw === 'undefined'
        ? null
        : String(nextCategoryIdRaw || '').trim();
    if (nextCategoryId) {
      const category = await prisma.category.findUnique({ where: { id: nextCategoryId } });
      if (!category) throw new BadRequestError('Invalid category selected');
    }

    const finalData: Prisma.HoardingUpdateInput = {
      ...incoming,
      rateHistory: this.sanitizeRateHistory((incoming as any).rateHistory) as any,
      standardRate,
      minimumRate,
      // Keep legacy field in sync for backward compatibility.
      baseRate: standardRate,
    } as any;

    if (typeof (incoming as any).landlordId !== 'undefined') {
      const landlordId = await this.ensureLandlordExists((incoming as any).landlordId);
      (finalData as any).landlord = { connect: { id: landlordId } };
    }

    delete (finalData as any).landlordId;

    return hoardingRepository.update(id, finalData);
  }

  async getById(id: string) {
    const hoarding = (await hoardingRepository.findById(id)) as any;
    if (!hoarding) return hoarding;

    const campaignMetaByHoardingId = await this.getLatestCampaignMetaByHoardingIds([id]);
    this.attachCampaignMeta(hoarding, campaignMetaByHoardingId);

    const currentStatus = String(hoarding.status || '').toLowerCase();
    if (currentStatus === 'tokenized') {
      const now = new Date();
      const phase3Enabled = await supportsPhase3BlockingSchema();
      const activeStatuses = phase3Enabled
        ? (['BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] as const)
        : (['ACTIVE'] as const);

      const activeBlock = await prisma.bookingToken.findFirst({
        where: {
          hoardingId: id,
          status: { in: activeStatuses as any },
          ...(phase3Enabled ? { expiresAt: { gt: now }, releasedAt: null as any } : {}),
        } as any,
        select: { id: true },
      });

      if (activeBlock) {
        hoarding.status = 'blocked';
      }
    }

    return hoarding;
  }

  async getAll(
    params: GetAllParams,
    user?: {
      id?: string;
      role: { name: string };
      territories?: { territory: { city: string | null } }[];
    },
  ) {
    const {
      page = 1,
      limit = 10,
      city,
      area,
      landmark,
      location,
      type,
      size,
      availability,
      status,
      ownership,
      categoryId,
    } = params;
    const effectiveStatus = status || availability;
    const pageNum = parseInt(page as string) || 1;
    // For Sales users, prefer a larger page size (50) by default to reduce paging frequency
    const parsedLimit = parseInt(limit as string);
    const startDate = params.startDate;
    const endDate = params.endDate;
    const limitNum =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : user && user.role.name === 'sales'
          ? 50
          : 10;
    const skip = (pageNum - 1) * limitNum;
    const take = limitNum;

    const where: Prisma.HoardingWhereInput = { isDeleted: false };
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (area) where.area = { contains: area, mode: 'insensitive' };
    if (landmark) where.landmark = { contains: landmark, mode: 'insensitive' };
    if (type) where.type = { contains: type, mode: 'insensitive' };
    if (location) {
      where.OR = [
        { landmark: { contains: location, mode: 'insensitive' } },
        { roadName: { contains: location, mode: 'insensitive' } },
        { side: { contains: location, mode: 'insensitive' } },
        { title: { contains: location, mode: 'insensitive' } },
      ];
    }
    if (ownership) where.ownership = ownership; // Exact match for ownership
    if (categoryId) where.categoryId = String(categoryId);
    // Delay applying hoarding-level status; Sales 'available' is handled specially below

    // Sales view: show hoardings across the system. We will still apply territory-based city
    // filtering (if the user has territories) but DO NOT restrict sales to only hoardings that
    // belong to properties currently on rent — sales should be able to view all faces.
    if (user && user.role.name === 'sales') {
      const territories = user.territories || [];
      const allowedCities = territories
        .map((ut: { territory: { city: string | null } }) => ut.territory.city)
        .filter((c: string | null): c is string => !!c);
      if (allowedCities.length > 0) {
        where.city = { in: allowedCities, mode: 'insensitive' };
      }
      // For Sales 'available' we will post-filter; skip adding where.status here
    }

    // For non-Sales or other statuses, apply status filter directly.
    // Sales availability modes are computed post-query and should not be used as raw DB status.
    const effectiveLower = String(effectiveStatus || '').toLowerCase();
    const isSales = !!(user && user.role.name === 'sales');

    const isSalesAvailabilityMode =
      !!(user && user.role.name === 'sales') &&
      ['available', 'available_free', 'available_in_range'].includes(effectiveLower);
    if (effectiveStatus) {
      if (isSales && effectiveLower === 'available') {
        // Include blocked so sales can still propose blocked inventory to other clients.
        where.status = { in: ['available', 'tokenized', 'blocked'] } as any;
      } else if (!isSalesAvailabilityMode) {
        if (effectiveLower === 'available') {
          where.status = { in: ['available', 'tokenized', 'blocked'] } as any;
        } else {
          where.status = effectiveStatus;
        }
      }
    }

    const result = await hoardingRepository.findAll({ skip, take, where });
    // Compute hasActiveToken flag per hoarding using included tokens
    const now = new Date();

    // For Sales users, compute whether *this* salesperson already has an active token per hoarding.
    // This is used by the UI to disable the Book(Token) button and must persist across refresh.
    let myActiveTokenSet = new Set<string>();
    const myActiveTokenIdByHoarding = new Map<string, string>();
    const myDraftProposalIdByHoarding = new Map<string, string>();
    if (user && user.role.name === 'sales' && user.id) {
      const ids = (result.hoardings as unknown as Array<{ id?: string }>)
        .map((h) => String(h.id || ''))
        .filter(Boolean);
      if (ids.length > 0) {
        const supportsPhase3 = await supportsPhase3BlockingSchema();
        const mine = await prisma.bookingToken.findMany({
          where: {
            hoardingId: { in: ids },
            salesUserId: user.id,
            ...(supportsPhase3
              ? {
                  OR: [
                    { status: 'PENDING' },
                    {
                      status: { in: ['BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] },
                      expiresAt: { gt: now },
                    },
                  ],
                }
              : {
                  status: 'ACTIVE',
                }),
          },
          select: { id: true, hoardingId: true, status: true, createdAt: true, notes: true },
          orderBy: { createdAt: 'desc' },
        });
        for (const t of mine as any[]) {
          const hid = String(t.hoardingId || '');
          if (!hid) continue;
          if (!myActiveTokenIdByHoarding.has(hid) && t.id) {
            myActiveTokenIdByHoarding.set(hid, String(t.id));
          }
          const notes = String(t.notes || '');
          const m = notes.match(PROPOSAL_TOKEN_MARKER_RE);
          if (m && m[1] && !myDraftProposalIdByHoarding.has(hid)) {
            myDraftProposalIdByHoarding.set(hid, String(m[1]));
          }
        }
        myActiveTokenSet = new Set(mine.map((t: any) => String(t.hoardingId)));
      }
    }
    type TokenLite = {
      status?: string;
      expiresAt?: Date | string | null;
      dateFrom?: Date | string | null;
      dateTo?: Date | string | null;
    };
    type HoardingRow = {
      id?: string;
      status?: string;
      expiryDate?: Date | string | null;
      propertyRent?: unknown;
      tokens?: TokenLite[];
    } & Record<string, unknown>;

    const requestedOnRent = String(effectiveStatus || '').toLowerCase() === 'on_rent';
    const requestedRangeAvailability =
      String(effectiveStatus || '').toLowerCase() === 'available_in_range';
    const campaignMetaByHoardingId = await this.getLatestCampaignMetaByHoardingIds(
      (result.hoardings as unknown as Array<{ id?: string }>).map((h) => String(h.id || '')),
    );

    const hoardingsWithFlag = (result.hoardings as unknown as HoardingRow[]).map((h) => {
      const tokens: TokenLite[] = Array.isArray(h.tokens) ? h.tokens : [];
      const hasActiveToken = tokens.some((t: TokenLite) => {
        const st = (t.status || '').toUpperCase();
        if (!['PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'].includes(st)) return false;
        const exp = t.expiresAt ? new Date(t.expiresAt as Date) : null;
        // PENDING tokens are queued and may not have expiresAt.
        if (st !== 'PENDING' && exp && exp <= now) return false;
        return true;
      });
      // Normalize hoarding status for Sales: treat legacy 'on_rent' as available.
      // This keeps sales operational flow independent from landlord rent configuration.
      let normalizedStatus = String(h.status || '').toLowerCase();
      if (
        isSales &&
        normalizedStatus === 'on_rent' &&
        !requestedOnRent &&
        !requestedRangeAvailability
      ) {
        normalizedStatus = 'available';
      }

      const myActiveToken = isSales && user?.id ? myActiveTokenSet.has(String(h.id)) : false;
      const myActiveTokenId =
        isSales && user?.id ? myActiveTokenIdByHoarding.get(String(h.id)) || null : null;
      const myDraftProposalId =
        isSales && myDraftProposalIdByHoarding
          ? myDraftProposalIdByHoarding.get(String(h.id)) || null
          : null;
      const enriched = Object.assign({}, h, {
        hasActiveToken,
        myActiveToken,
        myActiveTokenId,
        myDraftProposalId,
        status: normalizedStatus,
      });

      return this.attachCampaignMeta(enriched, campaignMetaByHoardingId);
    });

    // Optional size filter (feet-based): accepts inputs like "10x20", "10ft x 20ft".
    let sizeFiltered = hoardingsWithFlag;
    if (size && size.trim()) {
      const m = String(size)
        .trim()
        .match(/(\d+)\s*(?:ft)?\s*[x×*]\s*(\d+)\s*(?:ft)?/i);
      if (m) {
        const wantW = parseInt(m[1], 10);
        const wantH = parseInt(m[2], 10);
        if (Number.isFinite(wantW) && Number.isFinite(wantH)) {
          sizeFiltered = sizeFiltered.filter((h: any) => {
            const w = typeof h.widthCm === 'number' ? h.widthCm : null;
            const ht = typeof h.heightCm === 'number' ? h.heightCm : null;
            if (!w || !ht) return false;
            const ftW = Math.round(w / 30.48);
            const ftH = Math.round(ht / 30.48);
            return ftW === wantW && ftH === wantH;
          });
        }
      }
    }

    // effectiveLower computed above
    // Apply Sales availability post-filters
    // Post-filtering for available mode removed and moved to database query level

    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    const filtered = sizeFiltered.filter((h: HoardingRow & { hasActiveToken?: boolean }) => {
      const s = String(h.status || '').toLowerCase();
      if (s !== 'live') return false;
      const expiryRaw = h.expiryDate;
      if (!expiryRaw) return false;
      const expiry = new Date(expiryRaw);
      if (Number.isNaN(expiry.getTime())) return false;
      const diff = expiry.getTime() - now.getTime();
      return diff >= 0 && diff <= fifteenDaysMs;
    });

    if (user && user.role.name === 'sales' && effectiveLower === 'available_free') {
      const filtered = sizeFiltered.filter((h: HoardingRow & { hasActiveToken?: boolean }) => {
        const s = String(h.status || '').toLowerCase();
        return (s === 'available' || s === 'live') && h.hasActiveToken !== true;
      });
      return { hoardings: filtered, total: filtered.length, page: pageNum, limit: limitNum };
    }

    if (user && user.role.name === 'sales' && effectiveLower === 'available_in_range') {
      const rangeStart = startDate ? new Date(String(startDate)) : null;
      const rangeEnd = endDate ? new Date(String(endDate)) : null;
      if (
        !rangeStart ||
        !rangeEnd ||
        Number.isNaN(rangeStart.getTime()) ||
        Number.isNaN(rangeEnd.getTime())
      ) {
        return { hoardings: [], total: 0, page: pageNum, limit: limitNum };
      }
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
      if (rangeStart.getTime() > rangeEnd.getTime()) {
        return { hoardings: [], total: 0, page: pageNum, limit: limitNum };
      }

      const filtered = sizeFiltered.filter((h: HoardingRow) => {
        const s = String(h.status || '').toLowerCase();
        if (s === 'available') return true;

        const expiryRaw = h.expiryDate;
        if (!expiryRaw) return false;
        const expiry = new Date(expiryRaw);
        if (Number.isNaN(expiry.getTime())) return false;
        return expiry >= rangeStart && expiry <= rangeEnd;
      });

      return { hoardings: filtered, total: filtered.length, page: pageNum, limit: limitNum };
    }

    // For non-sales (or sales without the special available filter), apply size filtering if requested.
    if (sizeFiltered !== hoardingsWithFlag) {
      return {
        hoardings: sizeFiltered,
        total: sizeFiltered.length,
        page: pageNum,
        limit: limitNum,
      };
    }

    return { hoardings: hoardingsWithFlag, total: result.total, page: pageNum, limit: limitNum };
  }

  async listCities(): Promise<string[]> {
    const rows = await prisma.hoarding.findMany({
      where: { city: { not: null } },
      select: { city: true },
      distinct: ['city'],
      orderBy: { city: 'asc' },
    });

    return rows
      .map((row: { city: string | null }) => String(row.city || '').trim())
      .filter(Boolean);
  }

  async listLandmarks(): Promise<string[]> {
    const rows = await prisma.hoarding.findMany({
      where: { landmark: { not: null } },
      select: { landmark: true },
      distinct: ['landmark'],
      orderBy: { landmark: 'asc' },
    });

    return rows
      .map((row: { landmark: string | null }) => String(row.landmark || '').trim())
      .filter(Boolean);
  }

  async listTypes(): Promise<string[]> {
    const rows = await prisma.hoarding.findMany({
      where: { type: { not: null } },
      select: { type: true },
      distinct: ['type'],
      orderBy: { type: 'asc' },
    });

    return rows
      .map((row: { type: string | null }) => String(row.type || '').trim())
      .filter(Boolean);
  }

  async getAvailability(id: string) {
    const bookings = await bookingRepository.findByHoardingId(id);
    return bookings.map((b) => ({
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
    }));
  }

  async listRemountRenewRows(input: { actorId: string; actorRole: string }) {
    await contractService.reconcileExpiredLiveHoardings();

    const role = String(input.actorRole || '')
      .toLowerCase()
      .trim();
    const tokenWhere: Record<string, unknown> = {
      status: { notIn: ['CANCELLED', 'RELEASED', 'EXPIRED'] },
      hoarding: {
        OR: [
          { status: { equals: 'live', mode: 'insensitive' } },
          { status: { equals: 'booked', mode: 'insensitive' } },
          { status: { equals: 'under_process', mode: 'insensitive' } },
          {
            // Include non-live hoardings if they still have an active/expiring contract
            id: {
              in: (
                await prisma.contract.findMany({
                  where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] } },
                  select: { hoardingId: true },
                })
              ).map((c: { hoardingId: string }) => c.hoardingId),
            },
          },
        ],
      },
    };
    if (role === 'sales') tokenWhere['salesUserId'] = input.actorId;

    const latestTokens = await prisma.bookingToken.findMany({
      where: tokenWhere as Prisma.BookingTokenWhereInput,
      orderBy: [{ createdAt: 'desc' }],
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
            minimumRate: true,
            finalRate: true,
            expiryDate: true,
            lastRenewedAt: true,
            remountStatus: true,
            remountRequestedAt: true,
            remountCompletedAt: true,
          },
        },
      },
    });

    const map = new Map<string, (typeof latestTokens)[number]>();
    for (const token of latestTokens) {
      const hoardingId = String(token.hoardingId || '');
      if (!hoardingId || map.has(hoardingId)) continue;
      map.set(hoardingId, token);
    }

    const rows = Array.from(map.values()).map((token) => {
      const hoarding = token.hoarding;
      const locationParts = [
        hoarding?.landmark,
        hoarding?.area,
        hoarding?.roadName,
        hoarding?.city,
      ].filter(Boolean);
      const recentRenewed =
        hoarding?.lastRenewedAt &&
        new Date(hoarding.lastRenewedAt).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000;
      return {
        id: String(hoarding?.id || token.hoardingId),
        tokenId: token.id,
        hoardingCode: hoarding?.code || '—',
        clientName: token.client?.name || '—',
        clientPhone: token.client?.phone || '—',
        location: locationParts.length ? locationParts.join(', ') : '—',
        currentStatus: String(hoarding?.status || '').toLowerCase(),
        remountStatus: hoarding?.remountStatus || null,
        remountRequestedAt: hoarding?.remountRequestedAt || null,
        remountCompletedAt: hoarding?.remountCompletedAt || null,
        minimumRate: hoarding?.minimumRate || null,
        finalRate: hoarding?.finalRate || null,
        expiryDate: hoarding?.expiryDate || token.dateTo || null,
        lastRenewedAt: hoarding?.lastRenewedAt || null,
        statusTag:
          hoarding?.remountStatus === 'PENDING'
            ? 'LIVE + REMOUNT PENDING'
            : recentRenewed
              ? 'LIVE (Renewed)'
              : 'LIVE',
      };
    });

    return rows.sort((a, b) => String(a.hoardingCode).localeCompare(String(b.hoardingCode)));
  }

  async requestRemount(hoardingId: string, actor: { id: string; roleName: string }) {
    const role = String(actor.roleName || '').toLowerCase();
    if (!['sales', 'owner', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { id: true, code: true, remountStatus: true, status: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const eligible = await this.isLiveOrActiveContract(hoardingId);
    if (!eligible) {
      throw new BadRequestError(
        'Only live hoardings or hoardings with active contract can be remounted',
      );
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.hoarding.update({
        where: { id: hoardingId },
        data: {
          remountStatus: 'PENDING',
          remountRequestedBy: actor.id,
          remountRequestedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'HOARDING_REMOUNT_REQUESTED',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            remountStatus: 'PENDING',
            requestedAt: now.toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    try {
      const recipients = await this.getUsersByRoles(['supervisor', 'owner', 'manager'], actor.id);
      if (recipients.length > 0) {
        await notificationService.notifyUsersIdempotent(
          recipients,
          'Remount request received',
          `Hoarding ${hoarding.code || hoardingId} is marked for remount by Sales.`,
          '/dashboard/supervisor',
          `REMOUNT_REQUEST:${hoardingId}:${now.toISOString().slice(0, 10)}`,
        );
      }
    } catch (_) {}

    return updated;
  }

  async sendSupervisorProceedReminder(
    hoardingId: string,
    actor: { id: string; roleName: string; name?: string },
  ) {
    const role = String(actor.roleName || '').toLowerCase();
    if (!['sales', 'owner', 'manager', 'accountant', 'admin'].includes(role)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { id: true, code: true, status: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const status = String(hoarding.status || '').toLowerCase();
    if (!['booked', 'under_process'].includes(status)) {
      throw new BadRequestError('Reminder can be sent only for booked or under process hoardings');
    }

    const recipients = await this.getUsersByRoles(['supervisor'], actor.id);
    if (!recipients.length) {
      throw new BadRequestError('No supervisor users available to notify');
    }

    const now = new Date();
    const actorName = String(actor.name || '').trim() || 'Sales Team';
    await notificationService.notifyUsersIdempotent(
      recipients,
      'Action required on hoarding',
      `${actorName} requested supervisor follow-up for hoarding ${hoarding.code || hoardingId}. Current status: ${status.toUpperCase()}. Please proceed further.`,
      '/dashboard/supervisor',
      `SUPERVISOR_PROCEED_REMINDER:${hoardingId}:${now.toISOString().slice(0, 10)}`,
    );

    try {
      await prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'HOARDING_SUPERVISOR_REMINDER_SENT',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            status,
            notifiedAt: now.toISOString(),
            notifiedRole: 'supervisor',
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (_) {}

    return {
      hoardingId,
      notified: true,
      notifiedRole: 'supervisor',
      notifiedCount: recipients.length,
    };
  }

  async completeRemount(hoardingId: string, actor: { id: string; roleName: string }) {
    const role = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { id: true, code: true, remountStatus: true, remountRequestedBy: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');
    if (hoarding.remountStatus !== 'PENDING') {
      throw new BadRequestError('Remount is not pending for this hoarding');
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.hoarding.update({
        where: { id: hoardingId },
        data: {
          remountStatus: 'COMPLETED',
          remountCompletedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'HOARDING_REMOUNT_COMPLETED',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            remountStatus: 'COMPLETED',
            completedAt: now.toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    try {
      const recipients = await this.getUsersByRoles(['owner', 'manager']);
      const requester = String(hoarding.remountRequestedBy || '').trim();
      if (requester) recipients.push(requester);
      const finalRecipients = Array.from(new Set(recipients.filter(Boolean)));
      if (finalRecipients.length > 0) {
        await notificationService.notifyUsersIdempotent(
          finalRecipients,
          'Remount completed',
          `Remount completed for hoarding ${hoarding.code || hoardingId}.`,
          '/dashboard/supervisor',
          `REMOUNT_COMPLETE:${hoardingId}:${now.toISOString().slice(0, 10)}`,
        );
      }
    } catch (_) {}

    return updated;
  }

  async renewHoarding(
    hoardingId: string,
    payload: { tenure: number; newAmount: number; remountRequired?: boolean },
    actor: { id: string; roleName: string },
  ) {
    const role = String(actor.roleName || '').toLowerCase();
    if (!['sales', 'owner', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError('Not allowed');
    }

    const tenure = Number(payload.tenure || 0);
    const newAmount = Number(payload.newAmount || 0);
    const remountRequired = !!payload.remountRequired;

    if (!Number.isFinite(tenure) || tenure <= 0 || tenure > 60) {
      throw new BadRequestError('New tenure must be between 1 and 60 months');
    }
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      throw new BadRequestError('New amount must be a valid positive number');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: {
        id: true,
        code: true,
        status: true,
        minimumRate: true,
        expiryDate: true,
      },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const eligible = await this.isLiveOrActiveContract(hoardingId);
    if (!eligible) {
      throw new BadRequestError(
        'Only live hoardings or hoardings with active contract can be renewed',
      );
    }

    const minimumRate = Number(hoarding.minimumRate || 0);
    if (newAmount < minimumRate) {
      throw new BadRequestError(`Amount is below minimum rate (${minimumRate})`);
    }

    const latestToken = await prisma.bookingToken.findFirst({
      where: {
        hoardingId,
        status: { notIn: ['CANCELLED', 'RELEASED', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { dateTo: true },
    });

    const previousExpiryDate = hoarding.expiryDate || latestToken?.dateTo || null;
    const now = new Date();
    const base =
      previousExpiryDate && new Date(previousExpiryDate) > now ? new Date(previousExpiryDate) : now;
    const newExpiryDate = this.addMonthsFrom(base, tenure);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const renewal = await tx.hoardingRenewal.create({
        data: {
          hoardingId,
          previousExpiryDate,
          newExpiryDate,
          renewedBy: actor.id,
          renewedAt: now,
          newAmount: new Prisma.Decimal(newAmount),
          tenure,
          remountRequired,
        },
      });

      const updatedHoarding = await tx.hoarding.update({
        where: { id: hoardingId },
        data: {
          expiryDate: newExpiryDate,
          finalRate: new Prisma.Decimal(newAmount),
          lastRenewedAt: now,
          remountStatus: remountRequired ? 'PENDING' : undefined,
          remountRequestedBy: remountRequired ? actor.id : undefined,
          remountRequestedAt: remountRequired ? now : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'HOARDING_RENEWED',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            previousExpiryDate: previousExpiryDate
              ? new Date(previousExpiryDate).toISOString()
              : null,
            newExpiryDate: newExpiryDate.toISOString(),
            newAmount,
            tenure,
            remountRequired,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      if (remountRequired) {
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: 'HOARDING_REMOUNT_REQUESTED',
            entityType: 'Hoarding',
            entityId: hoardingId,
            payload: {
              source: 'RENEWAL_FLOW',
              remountStatus: 'PENDING',
              requestedAt: now.toISOString(),
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return { renewal, updatedHoarding };
    });

    try {
      const roles = remountRequired ? ['supervisor', 'owner', 'manager'] : ['owner', 'manager'];
      const recipients = await this.getUsersByRoles(roles, actor.id);
      if (recipients.length > 0) {
        await notificationService.notifyUsersIdempotent(
          recipients,
          remountRequired ? 'Hoarding renewed with remount' : 'Hoarding renewed',
          remountRequired
            ? `Hoarding ${hoarding.code || hoardingId} renewed and marked for remount.`
            : `Hoarding ${hoarding.code || hoardingId} renewed by Sales.`,
          '/sales/remount-renew',
          `HOARDING_RENEW:${hoardingId}:${now.toISOString().slice(0, 10)}:${remountRequired ? 'Y' : 'N'}`,
        );
      }
    } catch (_) {}

    return {
      hoardingId,
      renewalId: result.renewal.id,
      previousExpiryDate,
      newExpiryDate,
      newAmount,
      tenure,
      remountRequired,
      remountStatus: remountRequired ? 'PENDING' : result.updatedHoarding.remountStatus || null,
    };
  }

  async listRenewalHistory(hoardingId: string) {
    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { id: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const history = await prisma.hoardingRenewal.findMany({
      where: { hoardingId },
      orderBy: { renewedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });

    return history.map(
      (row: {
        id: string;
        previousExpiryDate: Date | null;
        newExpiryDate: Date;
        renewedBy: string;
        renewedAt: Date;
        newAmount: Prisma.Decimal;
        tenure: number;
        remountRequired: boolean;
        user?: { id: string; name: string | null } | null;
      }) => ({
        id: row.id,
        previousExpiryDate: row.previousExpiryDate,
        newExpiryDate: row.newExpiryDate,
        renewedById: row.renewedBy,
        renewedByName: row.user?.name || null,
        renewedAt: row.renewedAt,
        newAmount: row.newAmount,
        tenure: row.tenure,
        remountRequired: row.remountRequired,
      }),
    );
  }

  async delete(id: string, mode: 'recycle' | 'permanent' = 'recycle', actorId?: string) {
    const hoarding = await prisma.hoarding.findUnique({
      where: { id },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    if (mode === 'recycle') {
      if (hoarding.isDeleted) {
        throw new BadRequestError('Hoarding is already in the recycle bin');
      }

      const result = await prisma.$transaction(async (tx: any) => {
        const deletedHoarding = await tx.deletedHoarding.create({
          data: {
            hoardingId: hoarding.id,
            code: hoarding.code,
            city: hoarding.city,
            area: hoarding.area,
            landmark: hoarding.landmark,
            deletedById: actorId || null,
            originalStatus: hoarding.status,
            data: hoarding as any,
          },
        });

        const updated = await tx.hoarding.update({
          where: { id },
          data: {
            isDeleted: true,
            status: 'deleted',
          },
        });

        await tx.auditLog.create({
          data: {
            userId: actorId || null,
            action: 'HOARDING_SOFT_DELETED',
            entityType: 'Hoarding',
            entityId: id,
            payload: {
              code: hoarding.code,
              originalStatus: hoarding.status,
            } as any,
          },
        });

        return { updated, deletedHoarding };
      });

      try {
        const managers = await userRepository.findByRole('manager');
        const managerIds = managers.map((m: any) => m.id);
        const title = 'Property Moved to Recycle Bin';
        const body = `Property/hoarding ${hoarding.code} has been moved to the recycle bin.`;
        await notificationService.notifyUsers(managerIds, title, body, `/recycle-bin`);
      } catch (e) {
        console.error('Failed to notify managers on soft delete:', e);
      }

      return result;
    } else {
      try {
        const deleted = await prisma.$transaction(async (tx: any) => {
          await tx.deletedHoarding.deleteMany({
            where: { hoardingId: id },
          });

          await tx.supervisorChecklist.deleteMany({ where: { hoardingId: id } });
          await tx.rent.deleteMany({ where: { hoardingId: id } });
          await tx.hoardingRenewal.deleteMany({ where: { hoardingId: id } });
          
          return tx.hoarding.delete({
            where: { id },
          });
        });

        try {
          await prisma.auditLog.create({
            data: {
              userId: actorId || null,
              action: 'HOARDING_PERMANENTLY_DELETED',
              entityType: 'Hoarding',
              entityId: id,
              payload: { code: hoarding.code } as any,
            },
          });
        } catch (_) {}

        try {
          const managers = await userRepository.findByRole('manager');
          const managerIds = managers.map((m: any) => m.id);
          const title = 'Property Permanently Deleted';
          const body = `Property/hoarding ${hoarding.code} has been permanently deleted.`;
          await notificationService.notifyUsers(managerIds, title, body, undefined);
        } catch (e) {
          console.error('Failed to notify managers on permanent delete:', e);
        }

        return deleted;
      } catch (error: any) {
        if (error.code === 'P2003') {
          throw new BadRequestError('Cannot permanently delete hoarding because it has associated bookings, contracts, or billing history.');
        }
        throw error;
      }
    }
  }

  async addImageMetadata(hoardingId: string, args: { type: string; filenames: string[] }) {
    const hoarding = await hoardingRepository.findById(hoardingId);
    if (!hoarding) throw new Error('Hoarding not found');

    const rawImages = hoarding.images as unknown;
    let existing: unknown[] = [];
    if (Array.isArray(rawImages)) existing = rawImages as unknown[];
    else if (rawImages) existing = [rawImages];
    const now = new Date();
    const toAdd = args.filenames.map((fn, idx) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${idx}`,
      filename: fn,
      type: args.type,
      createdAt: now,
    }));
    const updatedImages = [...existing, ...toAdd];
    
    const updateData: Prisma.HoardingUpdateInput = {
      images: updatedImages as Prisma.InputJsonValue,
    };
    if (!hoarding.installationDate) {
      updateData.installationDate = now;
    }

    const updated = await hoardingRepository.update(hoardingId, updateData);
    return updated;
  }

  async markUnderProcess(id: string, actor?: { id?: string; roleName?: string }) {
    const updated = await hoardingRepository.update(id, {
      status: 'under_process',
    } as unknown as Prisma.HoardingUpdateInput);

    try {
      eventBus.emit('hoarding-status', {
        hoardingId: id,
        status: 'under_process',
        hasActiveToken: true,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    // Notify owners when a manager marks under_process (non-blocking)
    try {
      if (process.env.NODE_ENV === 'test') return updated;
      if ((actor?.roleName || '').toLowerCase() === 'manager') {
        const owners = await userRepository.findByRole('owner');
        const ownerIds = owners
          .map((o: any) => o.id)
          .filter((uid: any) => uid && uid !== actor?.id);
        if (ownerIds.length > 0) {
          const manager = actor?.id ? await userRepository.findById(actor.id) : null;
          const hoarding = await hoardingRepository.findById(id);
          const title = 'Hoarding Under Process';
          const body = `${manager?.name || 'Manager'} marked ${hoarding?.code || id} as Under Process.`;
          const link = `/hoardings/${id}`;
          await notificationService.notifyUsers(ownerIds, title, body, link);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to notify owners on under-process:', e);
    }

    return updated;
  }

  async finalizeWorkflowStatus(
    id: string,
    nextStatusRaw: string,
    actor?: { id?: string; roleName?: string },
  ) {
    const roleLower = String(actor?.roleName || '').toLowerCase();
    if (!['owner', 'manager', 'sales'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const next = String(nextStatusRaw || '')
      .toLowerCase()
      .trim();
    if (!['booked', 'blocked', 'available'].includes(next)) {
      throw new BadRequestError('Invalid final status');
    }

    // Fetch with bookedBy for helpful idempotency messaging
    type HoardingBookedByShape = {
      status?: string | null;
      bookedBy?: { role?: { name?: string | null } | null } | null;
    };
    const prismaUnsafe = prisma as unknown as {
      hoarding: {
        findUnique: (args: unknown) => Promise<HoardingBookedByShape | null>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
    };

    const currentRow = await prismaUnsafe.hoarding.findUnique({
      where: { id },
      include: { bookedBy: { include: { role: true } } },
    });
    if (!currentRow) throw new NotFoundError('Hoarding not found');

    const current = String(currentRow.status || '')
      .toLowerCase()
      .trim();

    if (next === 'available') {
      if (current === 'booked') {
        const byRole = currentRow.bookedBy?.role?.name
          ? String(currentRow.bookedBy.role.name)
          : 'User';
        throw new ConflictError(`Cannot mark available because already booked by ${byRole}`);
      }
      if (current === 'available') {
        return hoardingRepository.findById(id);
      }

      const availableCount = await prismaUnsafe.hoarding.updateMany({
        where: {
          id,
          status: { not: 'booked' } as any,
        },
        data: {
          status: 'available',
          workflowState: null,
          bookedById: null,
          bookedAt: null,
        },
      });

      if (!availableCount || availableCount.count !== 1) {
        throw new ConflictError('This hoarding has already been updated by another user.');
      }

      const availableRow = await hoardingRepository.findById(id);
      try {
        eventBus.emit('hoarding-status', {
          hoardingId: id,
          status: 'available',
          hasActiveToken: false,
          updatedAt: new Date().toISOString(),
        });
      } catch (_) {}

      try {
        if (roleLower === 'sales' && current === 'blocked' && actor?.id) {
          const code = String((availableRow as any)?.code || id);
          await notificationService.notifyUsers(
            [String(actor.id)],
            'Hoarding unblocked',
            `Hoarding ${code} unblocked.`,
            '/notifications',
          );
        }
      } catch (_) {}

      return availableRow;
    }

    if (next === 'blocked') {
      if (current === 'booked') {
        const byRole = currentRow.bookedBy?.role?.name
          ? String(currentRow.bookedBy.role.name)
          : 'User';
        throw new ConflictError(`Cannot block because already booked by ${byRole}`);
      }
      if (current === 'blocked') {
        return hoardingRepository.findById(id);
      }

      const blockedCount = await prismaUnsafe.hoarding.updateMany({
        where: { id, status: { not: 'booked' } as any },
        data: {
          status: 'blocked',
          workflowState: null,
        },
      });

      if (!blockedCount || blockedCount.count !== 1) {
        throw new ConflictError('This hoarding has already been updated by another user.');
      }

      const blockedRow = await hoardingRepository.findById(id);
      try {
        eventBus.emit('hoarding-status', {
          hoardingId: id,
          status: 'blocked',
          hasActiveToken: false,
          updatedAt: new Date().toISOString(),
        });
      } catch (_) {}

      return blockedRow;
    }

    if (current === 'booked') {
      const byRole = currentRow.bookedBy?.role?.name
        ? String(currentRow.bookedBy.role.name)
        : 'User';
      throw new ConflictError(`Already marked as booked by ${byRole}`);
    }
    if (current !== 'live') {
      throw new BadRequestError('Only Live hoardings can be marked as Booked');
    }

    const now = new Date();
    const updatedCount = await prismaUnsafe.hoarding.updateMany({
      where: { id, status: 'live' },
      data: {
        status: 'booked',
        workflowState: null,
        bookedById: actor?.id || null,
        bookedAt: now,
      },
    });

    if (!updatedCount || updatedCount.count !== 1) {
      const after = await prismaUnsafe.hoarding.findUnique({
        where: { id },
        include: { bookedBy: { include: { role: true } } },
      });
      if (!after) throw new NotFoundError('Hoarding not found');
      const st = String(after.status || '')
        .toLowerCase()
        .trim();
      if (st === 'booked') {
        const byRole = after.bookedBy?.role?.name ? String(after.bookedBy.role.name) : 'User';
        throw new ConflictError(`Already marked as booked by ${byRole}`);
      }
      throw new ConflictError('This hoarding has already been updated by another user.');
    }

    const updated = await hoardingRepository.findById(id);

    try {
      eventBus.emit('hoarding-status', {
        hoardingId: id,
        status: 'booked',
        hasActiveToken: false,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}

    return updated;
  }
}
