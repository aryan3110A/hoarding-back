import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { ChecklistService } from './checklist.service';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';
import { BillingEventService } from './billingEvent.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '../lib/errors';
import type { StoredImageAsset } from './mediaStorage.service';
import PDFDocument from 'pdfkit';

const checklistService = new ChecklistService();
const notificationService = new NotificationService();
const userRepository = new UserRepository();
const billingEventService = new BillingEventService();

const SUPERVISOR_STATUSES = [
  'booked',
  'under_process',
  'live',
  'removal_pending',
  'remount_pending',
] as const;

type ChecklistShape = {
  isCorrectSize?: boolean | null;
  isGoodCondition?: boolean | null;
  isFlexReceived?: boolean | null;
  isReadyForInstall?: boolean | null;
  isSiteImageUploaded?: boolean | null;
};

function checklistComplete(c: ChecklistShape | null | undefined) {
  return !!(
    c?.isCorrectSize &&
    c?.isGoodCondition &&
    c?.isFlexReceived &&
    c?.isReadyForInstall &&
    c?.isSiteImageUploaded
  );
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffMonths(from: Date, to: Date): number {
  const fromMonths = from.getFullYear() * 12 + from.getMonth();
  const toMonths = to.getFullYear() * 12 + to.getMonth();
  const base = toMonths - fromMonths;
  return base <= 0 ? 0 : base;
}

export class SupervisorService {
  private normalizeExecutionImageList(raw: unknown) {
    if (!raw) return [] as Array<Record<string, unknown>>;
    if (Array.isArray(raw)) {
      return raw
        .filter((item) => !!item && typeof item === 'object')
        .map((item) => {
          const record = item as Record<string, unknown>;
          const imageUrl =
            typeof record.image_url === 'string'
              ? record.image_url
              : typeof record.url === 'string'
                ? record.url
                : null;

          return imageUrl ? { ...record, image_url: imageUrl, url: imageUrl } : record;
        }) as Array<Record<string, unknown>>;
    }
    if (typeof raw === 'object') {
      const record = raw as Record<string, unknown>;
      const imageUrl =
        typeof record.image_url === 'string'
          ? record.image_url
          : typeof record.url === 'string'
            ? record.url
            : null;
      return [imageUrl ? { ...record, image_url: imageUrl, url: imageUrl } : record];
    }
    return [] as Array<Record<string, unknown>>;
  }

  private parseDateOrNull(raw: unknown): Date | null {
    if (!raw) return null;
    const dt = new Date(String(raw));
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  }

  private computeExecutionStatus(args: {
    status: string;
    remountStatus?: string | null;
    workflowState?: string | null;
    expiryDate?: Date | null;
    checklist?: { isFlexReceived?: boolean | null } | null;
  }):
    | 'pending'
    | 'received'
    | 'live'
    | 'remount_pending'
    | 'remounted'
    | 'unmount_pending'
    | 'unmounted' {
    const status = String(args.status || '').toLowerCase();
    const remountStatus = String(args.remountStatus || '').toUpperCase();
    const workflowState = String(args.workflowState || '').toUpperCase();

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soonCutoff = addDays(todayStart, 7);
    const expiryDate = args.expiryDate ? new Date(args.expiryDate) : null;
    const isExpired = !!(expiryDate && expiryDate < todayStart);
    const isSoonToExpire = !!(expiryDate && expiryDate >= todayStart && expiryDate <= soonCutoff);

    if (workflowState === 'EXEC_UNMOUNTED') return 'unmounted';
    if (
      status === 'removal_pending' ||
      workflowState === 'EXEC_UNMOUNT_PENDING' ||
      isExpired ||
      isSoonToExpire
    ) {
      return 'unmount_pending';
    }
    if (remountStatus === 'PENDING' || workflowState === 'EXEC_REMOUNT_PENDING') {
      return 'remount_pending';
    }
    if (remountStatus === 'COMPLETED' || workflowState === 'EXEC_REMOUNTED') {
      return 'remounted';
    }
    if (status === 'live') return 'live';
    if (args.checklist?.isFlexReceived) return 'received';
    return 'pending';
  }

  async listExecutionBoard(
    params: {
      tab?: string;
      page?: string;
      limit?: string;
      clientName?: string;
      city?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    actor: { id: string; roleName: string },
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin', 'sales'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const tab = String(params.tab || 'pending').toLowerCase();
    const pageNum = Math.max(1, parseInt(String(params.page || '1'), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(params.limit || '50'), 10) || 50));
    const clientNameFilter = String(params.clientName || '')
      .trim()
      .toLowerCase();
    const cityFilter = String(params.city || '')
      .trim()
      .toLowerCase();
    const statusFilter = String(params.status || '')
      .trim()
      .toLowerCase();
    const dateFrom = this.parseDateOrNull(params.dateFrom);
    const dateTo = this.parseDateOrNull(params.dateTo);
    if (dateFrom) dateFrom.setHours(0, 0, 0, 0);
    if (dateTo) dateTo.setHours(23, 59, 59, 999);

    const hoardingWhere: Prisma.HoardingWhereInput = {
      OR: [
        { status: { in: ['booked', 'under_process', 'live', 'removal_pending'] } },
        { remountStatus: 'PENDING' },
        { remountStatus: 'COMPLETED' },
        { expiryDate: { not: null } },
        {
          workflowState: {
            in: [
              'EXEC_PENDING',
              'EXEC_RECEIVED',
              'EXEC_REMOUNT_PENDING',
              'EXEC_REMOUNTED',
              'EXEC_UNMOUNT_PENDING',
              'EXEC_UNMOUNTED',
            ],
          },
        },
      ],
    };

    if (cityFilter) {
      hoardingWhere.city = { contains: cityFilter, mode: 'insensitive' };
    }

    const rows = await prisma.hoarding.findMany({
      where: hoardingWhere,
      include: { supervisorChecklist: true },
      orderBy: { updatedAt: 'desc' },
    });

    const hoardingIds = rows.map((row: any) => row.id);
    const tokens = hoardingIds.length
      ? await prisma.bookingToken.findMany({
          where: {
            hoardingId: { in: hoardingIds },
            status: {
              in: ['CONFIRMED', 'APPROVED', 'ACTIVE', 'PENDING', 'BLOCKED', 'EXTENSION_REQUESTED'],
            },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            hoardingId: true,
            plannedLiveDate: true,
            dateTo: true,
            createdAt: true,
            designStatus: true,
            designerId: true,
            client: {
              select: {
                id: true,
                name: true,
                phone: true,
                billingPhone: true,
              },
            },
          },
        })
      : [];

    const latestTokenByHoarding = new Map<string, (typeof tokens)[number]>();
    for (const token of tokens) {
      const key = String(token.hoardingId || '');
      if (!key || latestTokenByHoarding.has(key)) continue;
      latestTokenByHoarding.set(key, token);
    }

    const mapped = rows.map((row: any) => {
      const token = latestTokenByHoarding.get(String(row.id || ''));
      const executionStatus = this.computeExecutionStatus({
        status: String(row.status || ''),
        remountStatus: row.remountStatus || null,
        workflowState: row.workflowState || null,
        expiryDate: row.expiryDate || null,
        checklist: row.supervisorChecklist || null,
      });

      const imageList = this.normalizeExecutionImageList(row.supervisorChecklist?.siteImages);

      const executionDate = this.parseDateOrNull(
        token?.plannedLiveDate || row.expiryDate || row.updatedAt || null,
      );
      const dateMatches =
        !dateFrom ||
        !dateTo ||
        (!!executionDate && executionDate >= dateFrom && executionDate <= dateTo);

      return {
        id: row.id,
        code: row.code,
        city: row.city || null,
        area: row.area || null,
        landmark: row.landmark || null,
        roadName: row.roadName || null,
        status: row.status,
        remountStatus: row.remountStatus || null,
        workflowState: row.workflowState || null,
        executionType: row.executionType || null,
        plannedLiveDate: token?.plannedLiveDate || null,
        expiryDate: row.expiryDate || token?.dateTo || null,
        updatedAt: row.updatedAt,
        supervisorChecklist: row.supervisorChecklist || null,
        widthCm: row.widthCm || null,
        heightCm: row.heightCm || null,
        type: row.type || null,
        clientId: token?.client?.id || null,
        clientName: token?.client?.name || 'Unknown Client',
        clientPhone: token?.client?.phone || token?.client?.billingPhone || null,
        latestDesignStatus: token?.designStatus || null,
        latestDesignerId: token?.designerId || null,
        tokenId: token?.id || null,
        executionStatus,
        executionImages: imageList,
        _dateMatches: dateMatches,
      };
    });

    const tabFiltered = mapped.filter((row: any) => {
      const executionStatus = String(row.executionStatus || '').toLowerCase();
      const baseStatus = String(row.status || '').toLowerCase();
      const city = String(row.city || '').toLowerCase();
      const clientName = String(row.clientName || '').toLowerCase();

      if (!row._dateMatches) return false;
      if (clientNameFilter && !clientName.includes(clientNameFilter)) return false;
      if (cityFilter && !city.includes(cityFilter)) return false;
      if (statusFilter && executionStatus !== statusFilter) return false;

      if (tab === 'pending') {
        return (
          executionStatus === 'pending' ||
          executionStatus === 'received' ||
          baseStatus === 'booked' ||
          baseStatus === 'under_process'
        );
      }
      if (tab === 'live') {
        return baseStatus === 'live';
      }
      if (tab === 'remounting') {
        return executionStatus === 'remount_pending';
      }
      if (tab === 'unmounting') {
        return executionStatus === 'unmount_pending' || executionStatus === 'unmounted';
      }
      return true;
    });

    const sorted = [...tabFiltered].sort((a, b) => {
      if (tab === 'unmounting') {
        const cityA = String(a.city || '').toLowerCase();
        const cityB = String(b.city || '').toLowerCase();
        if (cityA !== cityB) return cityA.localeCompare(cityB);
      } else {
        const clientA = String(a.clientName || '').toLowerCase();
        const clientB = String(b.clientName || '').toLowerCase();
        if (clientA !== clientB) return clientA.localeCompare(clientB);
      }
      return (
        new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime()
      );
    });

    const start = (pageNum - 1) * limitNum;
    const paginated = sorted.slice(start, start + limitNum).map((row) => {
      const { _dateMatches, ...rest } = row;
      const groupKey =
        tab === 'unmounting'
          ? String(row.city || 'Unknown City')
          : String(row.clientName || 'Unknown Client');
      return {
        ...rest,
        groupKey,
      };
    });

    return {
      page: pageNum,
      limit: limitNum,
      total: sorted.length,
      rows: paginated,
      tab,
      groupBy: tab === 'unmounting' ? 'city' : 'clientName',
    };
  }

  async updateExecutionStatus(
    hoardingId: string,
    nextStatus:
      | 'pending'
      | 'received'
      | 'live'
      | 'remount_pending'
      | 'remounted'
      | 'unmount_pending'
      | 'unmounted',
    actor: { id: string; roleName: string },
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({ where: { id: hoardingId } });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    if (nextStatus === 'live') {
      return this.markLive(hoardingId, actor);
    }

    if (nextStatus === 'pending' || nextStatus === 'received') {
      const checklist = await checklistService.upsertChecklist(
        hoardingId,
        { isFlexReceived: nextStatus === 'received' },
        actor.id,
      );
      await prisma.hoarding.update({
        where: { id: hoardingId },
        data: { workflowState: nextStatus === 'received' ? 'EXEC_RECEIVED' : 'EXEC_PENDING' },
      });
      return checklist;
    }

    if (nextStatus === 'remount_pending') {
      return prisma.hoarding.update({
        where: { id: hoardingId },
        data: { remountStatus: 'PENDING', workflowState: 'EXEC_REMOUNT_PENDING' },
      });
    }

    if (nextStatus === 'remounted') {
      return prisma.hoarding.update({
        where: { id: hoardingId },
        data: {
          remountStatus: 'COMPLETED',
          remountCompletedAt: new Date(),
          workflowState: 'EXEC_REMOUNTED',
        },
      });
    }

    if (nextStatus === 'unmount_pending') {
      return prisma.hoarding.update({
        where: { id: hoardingId },
        data: {
          status: 'removal_pending',
          workflowState: 'EXEC_UNMOUNT_PENDING',
        },
      });
    }

    return prisma.hoarding.update({
      where: { id: hoardingId },
      data: { workflowState: 'EXEC_UNMOUNTED' },
    });
  }

  async uploadExecutionImages(
    hoardingId: string,
    actor: { id: string; roleName: string },
    type: 'mount' | 'remount' | 'unmount',
    files: StoredImageAsset[],
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      include: { supervisorChecklist: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');
    if (!files || files.length === 0) {
      throw new BadRequestError('At least one image is required');
    }

    const existing = this.normalizeExecutionImageList(hoarding.supervisorChecklist?.siteImages);
    const now = new Date().toISOString();
    const toAdd = files.map((file) => ({
      filename: file.filename,
      image_url: file.image_url || file.url,
      url: file.image_url || file.url,
      uploaded_by: actor.id,
      timestamp: file.uploadedAt || now,
      type,
      storage_provider: file.storage_provider,
      storage_path: file.storage_path,
      original_name: file.original_name,
      content_type: file.content_type,
      size_bytes: file.size_bytes,
    }));
    const merged = [...existing, ...toAdd];

    const updated = await prisma.supervisorChecklist.upsert({
      where: { hoardingId },
      create: {
        hoarding: { connect: { id: hoardingId } },
        updatedBy: { connect: { id: actor.id } },
        isSiteImageUploaded: true,
        siteImages: merged as unknown as Prisma.InputJsonValue,
      },
      update: {
        updatedById: actor.id,
        isSiteImageUploaded: true,
        siteImages: merged as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: actor.id || null,
        action: 'supervisor.execution_image_upload',
        entityType: 'Hoarding',
        entityId: hoardingId,
        payload: { type, count: files.length } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  }

  private async getOwnerManagerAdminIds(excludeUserId?: string): Promise<string[]> {
    const users = await userRepository.findByRoles(['owner', 'manager', 'admin']);
    const ids = users
      .map((u: { id: string }) => u.id)
      .filter((id: string) => !!id && id !== excludeUserId);
    return Array.from(new Set(ids));
  }
  async listDesigners() {
    const designers = await prisma.user.findMany({
      where: { isActive: true, role: { name: 'designer' } },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    return designers;
  }
  async listHoardings(params: {
    page?: string;
    limit?: string;
    status?: string;
    sizeMatch?: string;
    condition?: string;
    materialReceived?: string;
  }) {
    const pageNum = parseInt(params.page || '1') || 1;
    const limitNum = parseInt(params.limit || '20') || 20;
    const skip = (pageNum - 1) * limitNum;

    const status = String(params.status || '').toLowerCase();
    const sizeMatch = String(params.sizeMatch || '').toLowerCase();
    const condition = String(params.condition || '').toLowerCase();
    const materialReceived = String(params.materialReceived || '').toLowerCase();

    const normalizedStatus = SUPERVISOR_STATUSES.includes(
      status as (typeof SUPERVISOR_STATUSES)[number],
    )
      ? status
      : null;

    const where: Record<string, unknown> = {};
    if (normalizedStatus === 'remount_pending') {
      where.remountStatus = 'PENDING';
    } else if (normalizedStatus) {
      where.status = normalizedStatus;
    } else {
      where.OR = [
        { status: { in: [...SUPERVISOR_STATUSES.filter((s) => s !== 'remount_pending')] } },
        { remountStatus: 'PENDING' },
      ];
    }

    const checklistWhere: Record<string, unknown> = {};
    if (sizeMatch === 'yes') checklistWhere.isCorrectSize = true;
    if (sizeMatch === 'no') checklistWhere.isCorrectSize = false;
    if (materialReceived === 'yes') checklistWhere.isFlexReceived = true;
    if (materialReceived === 'no') checklistWhere.isFlexReceived = false;

    if (Object.keys(checklistWhere).length > 0) {
      where.supervisorChecklist = { ...checklistWhere };
    }

    if (condition === 'good') where.condition = 'GOOD';
    if (condition === 'damaged') where.condition = 'DAMAGED';

    const [rows, total] = await prisma.$transaction([
      prisma.hoarding.findMany({
        where: where as Prisma.HoardingWhereInput,
        skip,
        take: limitNum,
        orderBy: { updatedAt: 'desc' },
        include: { supervisorChecklist: true },
      }),
      prisma.hoarding.count({ where: where as Prisma.HoardingWhereInput }),
    ]);

    const hoardingIds = (rows || [])
      .map((h: { id?: string }) => String(h.id || ''))
      .filter(Boolean);
    const designStatusMap = new Map<string, string>();
    const plannedLiveDateMap = new Map<string, Date | null>();
    const clientIdMap = new Map<string, string>();
    const clientNameMap = new Map<string, string>();
    const clientPhoneMap = new Map<string, string>();
    const designerIdMap = new Map<string, string>();
    const designerNameMap = new Map<string, string>();
    if (hoardingIds.length > 0) {
      const tokens = await prisma.bookingToken.findMany({
        where: {
          hoardingId: { in: hoardingIds },
          status: {
            in: ['CONFIRMED', 'APPROVED', 'ACTIVE', 'PENDING', 'BLOCKED', 'EXTENSION_REQUESTED'],
          },
        },
        select: {
          hoardingId: true,
          clientId: true,
          designerId: true,
          designStatus: true,
          plannedLiveDate: true,
          createdAt: true,
          client: {
            select: {
              id: true,
              name: true,
              phone: true,
              billingPhone: true,
              companyName: true,
            },
          },
          designer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const t of tokens) {
        const hid = String(t.hoardingId || '');
        if (!hid) continue;
        if (!designStatusMap.has(hid)) {
          designStatusMap.set(hid, String(t.designStatus || ''));
        }
        if (!plannedLiveDateMap.has(hid)) {
          plannedLiveDateMap.set(hid, t.plannedLiveDate || null);
        }
        if (!clientIdMap.has(hid)) {
          clientIdMap.set(hid, String(t.client?.id || t.clientId || ''));
        }
        if (!clientNameMap.has(hid)) {
          clientNameMap.set(hid, String(t.client?.companyName || t.client?.name || ''));
        }
        if (!clientPhoneMap.has(hid)) {
          clientPhoneMap.set(hid, String(t.client?.phone || t.client?.billingPhone || ''));
        }
        if (!designerIdMap.has(hid)) {
          designerIdMap.set(hid, String(t.designer?.id || t.designerId || ''));
        }
        if (!designerNameMap.has(hid)) {
          designerNameMap.set(hid, String(t.designer?.name || t.designer?.email || ''));
        }
      }
    }

    const mappedRows = (rows || []).map((h: { id?: string }) => ({
      ...h,
      latestDesignStatus: designStatusMap.get(String(h.id || '')) || null,
      plannedLiveDate: plannedLiveDateMap.get(String(h.id || '')) || null,
      latestClientId: clientIdMap.get(String(h.id || '')) || null,
      latestClientName: clientNameMap.get(String(h.id || '')) || null,
      latestClientPhone: clientPhoneMap.get(String(h.id || '')) || null,
      latestDesignerId: designerIdMap.get(String(h.id || '')) || null,
      latestDesignerName: designerNameMap.get(String(h.id || '')) || null,
    }));

    return {
      page: pageNum,
      limit: limitNum,
      total,
      rows: mappedRows,
    };
  }

  async updateChecklist(
    hoardingId: string,
    data: {
      isCorrectSize?: boolean;
      isGoodCondition?: boolean;
      isFlexReceived?: boolean;
      isReadyForInstall?: boolean;
    },
    actor: { id: string; roleName: string },
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({ where: { id: hoardingId } });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    return checklistService.upsertChecklist(hoardingId, data, actor.id);
  }

  async uploadChecklistImages(
    hoardingId: string,
    actor: { id: string; roleName: string },
    files: StoredImageAsset[],
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({ where: { id: hoardingId } });
    if (!hoarding) throw new NotFoundError('Hoarding not found');
    if (!files || files.length === 0) {
      throw new BadRequestError('At least one image is required');
    }

    return checklistService.addSiteImages(hoardingId, actor.id, files);
  }

  async setExecutionType(
    hoardingId: string,
    executionType: 'CLIENT_CDR' | 'IN_HOUSE_DESIGN' | 'CLIENT_DIRECT_FLEX',
    actor: { id: string; roleName: string },
    designerId?: string,
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin', 'sales'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({ where: { id: hoardingId } });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const requiresDesigner = executionType !== 'CLIENT_DIRECT_FLEX';

    if (requiresDesigner) {
      if (!designerId || !designerId.trim()) {
        throw new BadRequestError('Designer is required for selected execution type');
      }
    }

    if (roleLower === 'sales') {
      if (hoarding.executionType !== 'IN_HOUSE_DESIGN') {
        throw new ForbiddenError('Sales can only assign designer for IN_HOUSE_DESIGN');
      }
      if (executionType !== 'IN_HOUSE_DESIGN') {
        throw new BadRequestError('Execution type cannot be changed by Sales');
      }
    }

    const token = await prisma.bookingToken.findFirst({
      where: {
        hoardingId,
        status: { in: ['CONFIRMED', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        designerId: true,
        salesUserId: true,
        hoardingId: true,
        designStatus: true,
      },
    });

    if (!token) {
      throw new BadRequestError('No confirmed token found for execution assignment');
    }

    if (String(token.designStatus || '').toLowerCase() === 'in_progress') {
      throw new BadRequestError('Cannot change execution or designer while design is in progress');
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.hoarding.update({
        where: { id: hoardingId },
        data:
          roleLower === 'sales'
            ? ({} as Prisma.HoardingUpdateInput)
            : ({ executionType } as Prisma.HoardingUpdateInput),
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id || null,
          action: 'supervisor.execution_type_set',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: { executionType } as unknown as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    if (!requiresDesigner) {
      await prisma.bookingToken.update({
        where: { id: token.id },
        data: {
          designerId: null,
          designStatus: 'COMPLETED',
        },
        select: { id: true },
      });

      try {
        await prisma.hoarding.update({
          where: { id: hoardingId },
          data: { workflowState: null },
        });
      } catch (_) {}
    } else {
      await prisma.bookingToken.update({
        where: { id: token.id },
        data: {
          designerId,
          designStatus: 'PENDING',
        },
        select: { id: true },
      });

      try {
        await prisma.hoarding.update({
          where: { id: hoardingId },
          data: { workflowState: 'DESIGN_ASSIGNED' },
        });
      } catch (_) {}

      try {
        await notificationService.notifyUsersIdempotent(
          [String(designerId)],
          'Design assignment',
          `You have been assigned a design for hoarding ${hoarding.code || hoardingId}.`,
          `/booking-tokens/${token.id}`,
          `ASSIGN_DESIGNER:${hoardingId}:${designerId}`,
        );
      } catch (_) {}
    }

    return updated;
  }

  async markFit(hoardingId: string, actor: { id: string; roleName: string }) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      include: { supervisorChecklist: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const currentStatus = String(hoarding.status || '').toLowerCase();
    if (currentStatus === 'under_process') return hoarding;
    if (!['booked'].includes(currentStatus)) {
      throw new BadRequestError('Only BOOKED hoardings can be marked Under Process');
    }

    if (!hoarding.executionType) {
      throw new BadRequestError('Execution type must be set before marking for fitting');
    }

    if (!checklistComplete(hoarding.supervisorChecklist)) {
      throw new BadRequestError('Checklist must be complete before marking for fitting');
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.hoarding.update({
        where: { id: hoardingId },
        data: { status: 'under_process' },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id || null,
          action: 'supervisor.mark_fit',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: { status: 'under_process' } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });

    try {
      const recipients = await this.getOwnerManagerAdminIds(actor.id);
      if (recipients.length > 0) {
        await notificationService.notifyUsersIdempotent(
          recipients,
          'Hoarding marked Under Process',
          `${updated.code || hoardingId} marked Under Process by supervisor.`,
          `/hoardings/${hoardingId}`,
          `sup_mark_fit:${hoardingId}`,
        );
      }
    } catch (_) {}

    return updated;
  }

  async markLive(
    hoardingId: string,
    actor: { id: string; roleName: string },
    liveDateInput?: string,
    billingStartDateInput?: string,
    billingPeriodOverrideNote?: string,
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const liveDateProvided = liveDateInput ? new Date(String(liveDateInput)) : null;
    if (liveDateProvided && isNaN(liveDateProvided.getTime())) {
      throw new BadRequestError('Invalid live date');
    }
    const billingStartOverride = billingStartDateInput
      ? new Date(String(billingStartDateInput))
      : null;
    if (billingStartOverride && isNaN(billingStartOverride.getTime())) {
      throw new BadRequestError('Invalid billing start date');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      include: { supervisorChecklist: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const currentStatus = String(hoarding.status || '').toLowerCase();
    if (currentStatus === 'live') return hoarding;
    if (!['under_process', 'booked'].includes(currentStatus)) {
      throw new BadRequestError('Only BOOKED or UNDER_PROCESS hoardings can be marked Live');
    }

    if (!checklistComplete(hoarding.supervisorChecklist)) {
      throw new BadRequestError(
        'Complete checklist (size, condition, flex received, ready for install, site image) before marking Live',
      );
    }

    const latestToken = await prisma.bookingToken.findFirst({
      where: {
        hoardingId,
        status: { in: ['CONFIRMED', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        salesUserId: true,
        designStatus: true,
        durationMonths: true,
        dateFrom: true,
        dateTo: true,
        plannedLiveDate: true,
      },
    });

    const plannedLiveDate = latestToken?.plannedLiveDate;
    if (!plannedLiveDate) {
      throw new BadRequestError('Live date must be set by Sales before marking Live');
    }

    if (liveDateProvided) {
      const plannedDay = plannedLiveDate.toISOString().slice(0, 10);
      const providedDay = liveDateProvided.toISOString().slice(0, 10);
      if (plannedDay !== providedDay) {
        throw new BadRequestError('Live date is set by Sales and cannot be changed');
      }
    }

    const liveDate = plannedLiveDate;
    const billingStartDate = billingStartOverride || liveDate;

    if (hoarding.executionType === 'IN_HOUSE_DESIGN') {
      const st = String(latestToken?.designStatus || '').toLowerCase();
      if (st !== 'completed') {
        throw new BadRequestError('Design must be completed before marking Live');
      }
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let computedExpiryDate: Date | null = null;
      if (latestToken) {
        const durationMonths =
          typeof latestToken.durationMonths === 'number' && latestToken.durationMonths > 0
            ? latestToken.durationMonths
            : latestToken.dateFrom && latestToken.dateTo
              ? diffMonths(new Date(latestToken.dateFrom), new Date(latestToken.dateTo))
              : 0;
        const durationDays =
          latestToken.dateFrom && latestToken.dateTo
            ? Math.round(
                (new Date(latestToken.dateTo).getTime() -
                  new Date(latestToken.dateFrom).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0;
        const endDate =
          durationMonths > 0
            ? addMonths(liveDate, durationMonths)
            : durationDays > 0
              ? addDays(liveDate, durationDays)
              : null;
        computedExpiryDate = endDate;
        if (endDate) {
          await tx.bookingToken.update({
            where: { id: latestToken.id },
            data: { dateFrom: liveDate, dateTo: endDate },
          });

          const booking = await tx.booking.findFirst({
            where: { hoardingId },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          if (booking) {
            await tx.booking.update({
              where: { id: booking.id },
              data: { startDate: liveDate, endDate },
            });
          }
        }
      }
      const updated = await tx.hoarding.update({
        where: { id: hoardingId },
        data: {
          status: 'live',
          actualLiveDate: liveDate,
          expiryDate: computedExpiryDate,
          billingStartDate,
          billingStartOverrideDate: billingStartOverride || null,
          billingPeriodOverrideNote: billingPeriodOverrideNote
            ? String(billingPeriodOverrideNote).trim() || null
            : null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id || null,
          action: 'supervisor.mark_live',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            status: 'live',
            liveDate: liveDate.toISOString(),
            billingStartDate: billingStartDate.toISOString(),
            billingPeriodOverrideNote: billingPeriodOverrideNote || null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });

    try {
      await billingEventService.activateForLive(hoardingId);
    } catch (_) {}

    try {
      const salesUserId = String(latestToken?.salesUserId || '');
      const salesHeads = await userRepository.findByRoles(['sales_head', 'sales head']);
      const salesHeadIds = salesHeads.map((u: { id: string }) => u.id).filter((id: string) => !!id && id !== actor.id);

      const locParts = [updated.city, updated.area, updated.landmark].filter(Boolean);
      const location = locParts.length > 0 ? locParts.join(', ') : (updated.code || 'specified location');

      // Notify assigned sales person and sales heads with the live reminder trigger
      const salesRecipients = [salesUserId, ...salesHeadIds].filter((id) => !!id && id !== actor.id);
      const uniqueSales = Array.from(new Set(salesRecipients));
      if (uniqueSales.length > 0) {
        await notificationService.notifyUsersIdempotent(
          uniqueSales,
          'Hoarding marked Live',
          `Shoot a message to client that the hoarding is live. Your hoarding is now live at ${location}.`,
          `/hoardings/${hoardingId}`,
          `sup_mark_live_sales:${hoardingId}`,
        );
      }

      // Notify owner, manager, admin as general notification
      const generalRecipients = await this.getOwnerManagerAdminIds(actor.id);
      const uniqueGeneral = Array.from(new Set(generalRecipients));
      if (uniqueGeneral.length > 0) {
        await notificationService.notifyUsersIdempotent(
          uniqueGeneral,
          'Hoarding marked Live',
          `${updated.code || hoardingId} marked Live by supervisor.`,
          `/hoardings/${hoardingId}`,
          `sup_mark_live:${hoardingId}`,
        );
      }
    } catch (_) {}

    return updated;
  }

  async setPlannedLiveDate(
    hoardingId: string,
    actor: { id: string; roleName: string },
    plannedLiveDateInput?: string,
  ) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin', 'sales'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    const plannedLiveDate = plannedLiveDateInput ? new Date(String(plannedLiveDateInput)) : null;
    if (!plannedLiveDate || isNaN(plannedLiveDate.getTime())) {
      throw new BadRequestError('Invalid live date');
    }

    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { id: true, status: true, code: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');
    const statusLower = String(hoarding.status || '').toLowerCase();
    if (statusLower === 'live') {
      throw new BadRequestError('Cannot change live date after hoarding is Live');
    }

    const latestToken = await prisma.bookingToken.findFirst({
      where: { hoardingId, status: { in: ['CONFIRMED', 'APPROVED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latestToken) throw new BadRequestError('No confirmed token found');

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const token = await tx.bookingToken.update({
        where: { id: latestToken.id },
        data: { plannedLiveDate } as unknown as Prisma.BookingTokenUpdateInput,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id || null,
          action: 'supervisor.set_live_date',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: {
            plannedLiveDate: plannedLiveDate.toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return token;
    });

    return updated;
  }

  async markRemoval(hoardingId: string, reason: string, actor: { id: string; roleName: string }) {
    const roleLower = String(actor.roleName || '').toLowerCase();
    if (!['supervisor', 'owner', 'manager', 'admin'].includes(roleLower)) {
      throw new ForbiddenError('Not allowed');
    }

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Removal reason is required');
    }

    const current = await prisma.hoarding.findUnique({ where: { id: hoardingId } });
    if (!current) throw new NotFoundError('Hoarding not found');
    const currentStatus = String(current.status || '').toLowerCase();
    if (currentStatus === 'removal_pending') return current;

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.hoarding.update({
        where: { id: hoardingId },
        data: { status: 'removal_pending' },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id || null,
          action: 'supervisor.mark_removal',
          entityType: 'Hoarding',
          entityId: hoardingId,
          payload: { status: 'removal_pending', reason } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });

    try {
      const recipients = await this.getOwnerManagerAdminIds(actor.id);
      if (recipients.length > 0) {
        await notificationService.notifyUsersIdempotent(
          recipients,
          'Hoarding marked for Removal',
          `${updated.code || hoardingId} marked for removal. Reason: ${reason}`,
          `/hoardings/${hoardingId}`,
          `sup_mark_removal:${hoardingId}`,
        );
      }
    } catch (_) {}

    return updated;
  }

  async generateOperationalPdf(hoardingId: string) {
    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      include: { supervisorChecklist: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));

    doc.addPage({ size: 'A4', margins: { top: 50, left: 50, right: 50, bottom: 50 } });
    doc.fontSize(18).text('Operational Hoarding Report', { align: 'left' });
    doc.moveDown(1);

    const line = (label: string, value?: string | number | null) => {
      doc.fontSize(11).text(`${label}: ${value ?? '—'}`);
    };

    line('Hoarding Code', hoarding.code);
    line('Location', `${hoarding.city || ''} ${hoarding.area || ''}`.trim() || '—');
    line('Landmark', hoarding.landmark || hoarding.roadName || '—');
    line(
      'Size',
      hoarding.widthCm && hoarding.heightCm
        ? `${hoarding.widthCm}cm x ${hoarding.heightCm}cm`
        : '—',
    );
    line('Execution Type', hoarding.executionType || '—');
    line('Condition', hoarding.condition || '—');
    doc.moveDown(0.5);

    const checklist = hoarding.supervisorChecklist;
    line('Checklist - Correct Size', checklist?.isCorrectSize ? 'Yes' : 'No');
    line('Checklist - Good Condition', checklist?.isGoodCondition ? 'Yes' : 'No');
    line('Checklist - Flex Received', checklist?.isFlexReceived ? 'Yes' : 'No');
    line('Checklist - Ready for Installation', checklist?.isReadyForInstall ? 'Yes' : 'No');

    doc.end();

    await new Promise((resolve) => doc.on('end', resolve));
    return Buffer.concat(chunks);
  }
}
