import InquiryRepository, {
  FollowupStatus,
  InquiryPerformanceStage,
  InquiryRow,
  InquirySource,
  InquiryStatus,
} from '../repositories/inquiry.repository';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';
import { ClientRepository } from '../repositories/client.repository';
import { prisma } from '../lib/prisma';

function normalizePhone(raw: unknown) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\D/g, '');
}

function normalizeEmail(raw: unknown) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return v.length > 0 ? v : null;
}

function normalizeText(raw: unknown) {
  return String(raw || '').trim();
}

function normalizeSource(raw: unknown): InquirySource {
  const v = String(raw || '')
    .trim()
    .toUpperCase();
  const allowed: InquirySource[] = [
    'WALK_IN',
    'SELF_GENERATED',
    'VIA_TELEPHONIC',
    'VIA_WHATSAPP',
    'REFERENCE',
    'OTHERS',
  ];
  if (allowed.includes(v as InquirySource)) return v as InquirySource;
  return 'WALK_IN';
}

function normalizeFollowupStatus(raw: unknown): FollowupStatus {
  const v = String(raw || '')
    .trim()
    .toUpperCase();
  const allowed: FollowupStatus[] = ['PENDING', 'DONE'];
  if (allowed.includes(v as FollowupStatus)) return v as FollowupStatus;
  return 'PENDING';
}

function normalizePerformanceStage(raw: unknown): InquiryPerformanceStage {
  const v = String(raw || '')
    .trim()
    .toUpperCase();
  const allowed: InquiryPerformanceStage[] = [
    'IN_PROCESS',
    'WON',
    'FOLLOW_UP_LATER',
    'DEAD',
    'NOT_INTERESTED',
  ];
  if (allowed.includes(v as InquiryPerformanceStage)) return v as InquiryPerformanceStage;
  return 'IN_PROCESS';
}

function parseOptionalDate(raw: unknown): Date | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError('Invalid date value');
  }
  return parsed;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDateIN(date: Date): string {
  return date.toLocaleDateString('en-IN');
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

const canAssignSales = (roleName: string) =>
  roleName === 'owner' || roleName === 'manager' || roleName === 'admin';

const SALES_IMMEDIATE_VISIBILITY_SOURCES: InquirySource[] = ['WALK_IN', 'SELF_GENERATED'];

const canOverrideDuplicatePhoneInquiry = (roleName: string) => roleName === 'owner';

const canSalesAccessInquiry = (row: InquiryRow, userId: string) => {
  const assignedSalesId = String(row.assignedSalesId || '').trim();
  const createdById = String(row.createdById || '').trim();
  const source = String(row.source || '')
    .trim()
    .toUpperCase();

  return (
    assignedSalesId === String(userId || '') ||
    (createdById === String(userId || '') &&
      SALES_IMMEDIATE_VISIBILITY_SOURCES.includes(source as InquirySource))
  );
};

export type AuthUserLite = {
  id: string;
  role: { name: string };
};

type InquiryCreateInput = {
  clientName: string;
  companyName?: string | null;
  phone: string;
  email?: string | null;
  city: string;
  area: string;
  location: string;
  purpose?: string | null;
  performanceStage?: InquiryPerformanceStage;
  source: InquirySource;
  clientId?: string | null;
  assignedSalesId?: string | null;
  categoryId?: string | null;
  firstContactDate?: Date | null;
  nextFollowupDate?: Date | null;
  followupStatus?: FollowupStatus;
  interestedHoardings?: string | null;
};

type InquiryUpdateInput = Partial<InquiryCreateInput> & {
  status?: InquiryStatus;
};

type QueryParams = Record<string, unknown>;
type ReminderRange = 'today' | 'next7' | 'all';

export class InquiryService {
  private repo = InquiryRepository;
  private notification = new NotificationService();
  private userRepo = new UserRepository();
  private clientRepo = new ClientRepository();

  private composeFollowupWhatsAppMessage(args: {
    clientName: string;
    companyName?: string | null;
    followupDate: Date;
    senderName: string;
  }) {
    const dueDate = formatDateIN(args.followupDate);
    const targetName = String(args.companyName || args.clientName || 'Client');
    return [
      `Hello ${targetName},`,
      '',
      `This is a follow-up reminder from Shubham Advertise. Your next follow-up is scheduled on ${dueDate}.`,
      '',
      'Please reply on this number for assistance.',
      '',
      'Regards,',
      args.senderName,
    ].join('\n');
  }

  private async sendFollowupWhatsAppMock(args: {
    inquiryId: string;
    actorUserId: string;
    phone: string;
    clientName: string;
    companyName?: string | null;
    followupDate: Date;
  }) {
    const sender = await this.userRepo.findById(args.actorUserId);
    const senderName = String(sender?.name || 'Sales Team').trim() || 'Sales Team';
    const message = this.composeFollowupWhatsAppMessage({
      clientName: args.clientName,
      companyName: args.companyName || null,
      followupDate: args.followupDate,
      senderName,
    });

    try {
      const prismaUnsafe = prisma as unknown as {
        auditLog: { create: (args: unknown) => Promise<unknown> };
      };
      await prismaUnsafe.auditLog.create({
        data: {
          userId: args.actorUserId,
          action: 'INQUIRY_FOLLOWUP_WHATSAPP_SENT',
          entityType: 'Inquiry',
          entityId: args.inquiryId,
          payload: {
            channel: 'WHATSAPP_MOCK',
            toPhone: args.phone,
            clientName: args.clientName,
            companyName: args.companyName || null,
            nextFollowupDate: args.followupDate.toISOString(),
            message,
            sentAt: new Date().toISOString(),
          },
        },
      });
    } catch (_) {
      // ignore non-critical WhatsApp mock logging failures
    }
  }

  private async notifyAssignedSales(params: {
    inquiryId: string;
    clientName: string;
    phone: string;
    assignedSalesId: string;
    assignedSalesName?: string | null;
    actorUserId: string;
    context: 'create' | 'update' | 'assign';
  }) {
    try {
      const actor = await this.userRepo.findById(params.actorUserId);
      const actorName = String(actor?.name || 'Owner/Manager/Admin');
      const salesName = String(params.assignedSalesName || 'Sales User');

      const title = 'Inquiry Assigned';
      const body = `${salesName}, inquiry for ${params.clientName} (${params.phone}) has been assigned to you by ${actorName}.`;
      const link = '/enquiries';
      const dedupeKey = `INQUIRY_ASSIGNED:${params.context}:${params.inquiryId}:${params.assignedSalesId}`;

      await this.notification.createNotification(
        params.assignedSalesId,
        title,
        body,
        link,
        dedupeKey,
      );
    } catch (_) {
      // Ignore notification failures for assignment side-effect
    }
  }

  async createInquiry(
    payload: Record<string, unknown>,
    user: AuthUserLite,
  ): Promise<{ inquiry: InquiryRow; created: boolean }> {
    const roleName = String(user?.role?.name || '').toLowerCase();
    if (!user?.id) throw new ForbiddenError('Unauthorized');
    if (
      roleName !== 'owner' &&
      roleName !== 'sales' &&
      roleName !== 'manager' &&
      roleName !== 'admin'
    ) {
      throw new ForbiddenError('Insufficient permissions');
    }

    const clientName = normalizeText(payload.clientName);
    const phone = normalizePhone(payload.phone);
    const companyName = payload.companyName != null ? normalizeText(payload.companyName) : null;
    const email = normalizeEmail(payload.email);
    const city = normalizeText(payload.city);
    const area = normalizeText(payload.area);
    const location = normalizeText(payload.location);
    const purpose = payload.purpose != null ? normalizeText(payload.purpose) : null;
    const source = normalizeSource(payload.source);
    const assignedSalesId =
      payload.assignedSalesId != null ? String(payload.assignedSalesId || '').trim() : '';
    const categoryId = payload.categoryId != null ? String(payload.categoryId || '').trim() : '';
    const firstContactDate = parseOptionalDate(payload.firstContactDate);
    const nextFollowupDate = parseOptionalDate(payload.nextFollowupDate);
    const followupStatus =
      nextFollowupDate != null ? 'PENDING' : normalizeFollowupStatus(payload.followupStatus);
    const performanceStage = normalizePerformanceStage(payload.performanceStage);
    const interestedHoardings = payload.interestedHoardings != null ? String(payload.interestedHoardings).trim() : null;

    if (!clientName) throw new BadRequestError('Client Name is required');
    if (!phone) throw new BadRequestError('Phone is required');
    if (phone.length !== 10) throw new BadRequestError('Phone must be exactly 10 digits');
    if (!city) throw new BadRequestError('City is required');
    if (!area) throw new BadRequestError('Area is required');
    if (!location) throw new BadRequestError('Location is required');
    if (nextFollowupDate && nextFollowupDate < startOfToday()) {
      throw new BadRequestError('Next follow-up date cannot be in the past');
    }
    if (assignedSalesId && !canAssignSales(roleName)) {
      throw new ForbiddenError('Only Owner/Manager/Admin can assign sales person');
    }

    let validatedAssignedSalesId: string | null = null;
    if (assignedSalesId) {
      const salesUser = await this.userRepo.findById(assignedSalesId);
      if (!salesUser || String(salesUser.role?.name || '').toLowerCase() !== 'sales') {
        throw new BadRequestError('Assigned user must be an active Sales user');
      }
      validatedAssignedSalesId = String(salesUser.id);
    } else if (
      roleName === 'sales' &&
      SALES_IMMEDIATE_VISIBILITY_SOURCES.includes(source as InquirySource)
    ) {
      validatedAssignedSalesId = user.id;
    }

    let validatedCategoryId: string | null = null;
    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category) throw new BadRequestError('Invalid category selected');
      validatedCategoryId = categoryId;
    }

    const existing = await this.repo.findPotentialDuplicate({ phone, email, city, area, location });
    const latestSamePhoneInquiry = await this.repo.findLatestByPhone(phone);
    const latestSamePhoneAssignedSalesId = String(
      (latestSamePhoneInquiry as any)?.assignedSalesId || '',
    ).trim();

    if (roleName === 'sales' && latestSamePhoneInquiry) {
      if (!latestSamePhoneAssignedSalesId && existing) {
        const updated = await this.repo.update(String((existing as any)?.id), {
          assignedSalesId: user.id,
        } as any);
        return { inquiry: updated as any, created: false };
      }

      if (latestSamePhoneAssignedSalesId && latestSamePhoneAssignedSalesId !== String(user.id)) {
        throw new ConflictError(
          'An inquiry for this client has already been created and is assigned to another sales person. Only the Owner can create a new inquiry for this client phone number.',
        );
      }

      if (existing) {
        return { inquiry: existing, created: false };
      }
    }

    if (existing && !canOverrideDuplicatePhoneInquiry(roleName)) {
      if (roleName === 'sales') {
        return { inquiry: existing, created: false };
      }

      throw new ConflictError(
        'An inquiry for this client has already been created. Only the Owner can create a new inquiry for the same phone number client.',
      );
    }

    const existingClientUnknown = await this.clientRepo.findByPhone(phone);
    const existingClient = existingClientUnknown as
      | null
      | ({
          id: string;
          name: string;
          phone: string;
          email?: string | null;
          companyName?: string | null;
        } & Record<string, unknown>);

    let clientId: string | null = null;
    if (existingClient) {
      const existingName = String(existingClient.name || '')
        .trim()
        .toLowerCase();
      const enteredName = String(clientName || '')
        .trim()
        .toLowerCase();
      if (
        existingName &&
        enteredName &&
        existingName !== enteredName &&
        !canOverrideDuplicatePhoneInquiry(roleName)
      ) {
        throw new ConflictError(
          `A client named '${existingClient.name}' is already registered with this phone number. Please use the existing client name or enter a different phone number.`,
        );
      }

      const patch: Record<string, unknown> = {};
      const existingEmail = normalizeEmail(existingClient.email);
      const existingCompanyName = normalizeText(existingClient.companyName || '');

      if (!existingEmail && email) {
        patch.email = email;
      }
      if (!existingCompanyName && companyName) {
        patch.companyName = companyName;
      }

      if (Object.keys(patch).length > 0) {
        await this.clientRepo.update(String(existingClient.id), patch as any);
      }

      clientId = String(existingClient.id);
    } else {
      const createdClientUnknown = await this.clientRepo.create({
        name: clientName,
        phone,
        email: email || null,
        createdById: user.id,
      });
      const createdClient = createdClientUnknown as { id: string } & Record<string, unknown>;
      clientId = String(createdClient.id);
    }

    const finalClientName = existingClient ? String(existingClient.name || clientName) : clientName;
    const finalCompanyName =
      existingClient && !companyName
        ? String(existingClient.companyName || '') || null
        : companyName;
    const finalEmail = existingClient && !email ? normalizeEmail(existingClient.email) : email;

    const createData: InquiryCreateInput & {
      status: InquiryStatus;
      createdById: string;
    } = {
      clientName: finalClientName,
      companyName: finalCompanyName,
      phone,
      email: finalEmail,
      city,
      area,
      location,
      purpose,
      performanceStage,
      source,
      clientId,
      assignedSalesId: validatedAssignedSalesId,
      categoryId: validatedCategoryId,
      firstContactDate,
      nextFollowupDate,
      followupStatus,
      interestedHoardings,
      status: 'OPEN',
      createdById: user.id,
    };

    const created = await this.repo.create(createData as unknown as Record<string, unknown>);

    if (interestedHoardings) {
      const codes = interestedHoardings.split(',').map(s => s.trim()).filter(Boolean);
      const hoardings = await prisma.hoarding.findMany({
        where: {
          OR: [
            { code: { in: codes } },
            { id: { in: codes } }
          ]
        },
        select: { id: true }
      });
      if (hoardings.length > 0) {
        await prisma.inquiryHoarding.createMany({
          data: hoardings.map((h: any) => ({
            inquiryId: created.id,
            hoardingId: h.id
          }))
        });
      }
    }

    if (validatedAssignedSalesId) {
      await this.notifyAssignedSales({
        inquiryId: String(created.id),
        clientName: String(created.clientName || clientName),
        phone: String(created.phone || phone),
        assignedSalesId: validatedAssignedSalesId,
        assignedSalesName: created.assignedSales?.name || null,
        actorUserId: user.id,
        context: 'create',
      });
    }

    return { inquiry: created, created: true };
  }

  async getById(id: string, user: AuthUserLite): Promise<InquiryRow> {
    const roleName = String(user?.role?.name || '').toLowerCase();
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Inquiry not found');

    if (roleName === 'sales' && !canSalesAccessInquiry(row, user.id)) {
      throw new ForbiddenError('Forbidden');
    }

    return row;
  }

  async updateInquiry(
    id: string,
    payload: Record<string, unknown>,
    user: AuthUserLite,
  ): Promise<InquiryRow> {
    const roleName = String(user?.role?.name || '').toLowerCase();
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Inquiry not found');

    const createdByRole = String(existing.createdBy?.role?.name || '').toLowerCase();

    if (roleName === 'sales') {
      if (!canSalesAccessInquiry(existing, user.id)) {
        throw new ForbiddenError('Forbidden');
      }
      if (payload.assignedSalesId != null) {
        throw new ForbiddenError('Sales cannot assign/change assigned sales person');
      }

      const wantsStatusChange = payload.status != null;
      const wantsPerformanceStageChange = payload.performanceStage != null;
      const wantsFieldChange =
        payload.clientName != null ||
        payload.companyName !== undefined ||
        payload.phone != null ||
        payload.email !== undefined ||
        payload.city != null ||
        payload.area != null ||
        payload.location != null ||
        payload.purpose !== undefined;
      const wantsFollowupChange =
        payload.firstContactDate !== undefined ||
        payload.nextFollowupDate !== undefined ||
        payload.followupStatus !== undefined;

      if (createdByRole === 'owner') {
        // Sales may change ONLY the status of Owner-created inquiries.
        if (!wantsStatusChange) {
          if (!wantsFollowupChange && !wantsPerformanceStageChange) {
            throw new ForbiddenError(
              'Sales can only change status, funnel stage, or follow-up for Owner-created inquiries',
            );
          }
        }
        if (wantsFieldChange) {
          throw new ForbiddenError('Sales cannot edit fields for Owner-created inquiries');
        }
      } else {
        const isCreator = existing.createdById === user.id;
        if (!isCreator) {
          if (wantsFieldChange) {
            throw new ForbiddenError(
              'Sales cannot edit core inquiry fields unless they created the inquiry',
            );
          }
          if (wantsStatusChange && !wantsFollowupChange && !wantsPerformanceStageChange) {
            throw new ForbiddenError(
              'Sales cannot change inquiry status unless they created the inquiry',
            );
          }
        }
      }
    }

    if (
      roleName !== 'owner' &&
      roleName !== 'sales' &&
      roleName !== 'manager' &&
      roleName !== 'admin'
    ) {
      throw new ForbiddenError('Insufficient permissions');
    }

    const data: InquiryUpdateInput = {};

    const originalStatus = existing.status;

    if (payload.clientName != null) data.clientName = normalizeText(payload.clientName);
    if (payload.companyName !== undefined) {
      data.companyName = payload.companyName != null ? normalizeText(payload.companyName) : null;
    }
    if (payload.phone != null) {
      const nextPhone = normalizePhone(payload.phone);
      if (nextPhone.length !== 10) throw new BadRequestError('Phone must be exactly 10 digits');
      data.phone = nextPhone;
    }
    if (payload.email !== undefined) data.email = normalizeEmail(payload.email);
    if (payload.city != null) data.city = normalizeText(payload.city);
    if (payload.area != null) data.area = normalizeText(payload.area);
    if (payload.location != null) data.location = normalizeText(payload.location);
    if (payload.purpose !== undefined)
      data.purpose = payload.purpose != null ? normalizeText(payload.purpose) : null;
    if (payload.source != null) data.source = normalizeSource(payload.source);
    if (payload.performanceStage != null) {
      data.performanceStage = normalizePerformanceStage(payload.performanceStage);
    }
    if (payload.firstContactDate !== undefined) {
      data.firstContactDate = parseOptionalDate(payload.firstContactDate);
    }
    if (payload.nextFollowupDate !== undefined) {
      const nextFollowupDate = parseOptionalDate(payload.nextFollowupDate);
      if (nextFollowupDate && nextFollowupDate < startOfToday()) {
        throw new BadRequestError('Next follow-up date cannot be in the past');
      }
      data.nextFollowupDate = nextFollowupDate;
      if (nextFollowupDate) {
        data.followupStatus = 'PENDING';
      }
    }
    if (payload.interestedHoardings !== undefined) {
      data.interestedHoardings = payload.interestedHoardings != null ? String(payload.interestedHoardings).trim() : null;
    }
    if (payload.followupStatus != null) {
      data.followupStatus = normalizeFollowupStatus(payload.followupStatus);
    }
    if (payload.categoryId != null) {
      const nextCategoryId = String(payload.categoryId || '').trim();
      if (!nextCategoryId) {
        data.categoryId = null;
      } else {
        const category = await prisma.category.findUnique({ where: { id: nextCategoryId } });
        if (!category) throw new BadRequestError('Invalid category selected');
        data.categoryId = nextCategoryId;
      }
    }

    if (payload.assignedSalesId != null) {
      if (!canAssignSales(roleName)) {
        throw new ForbiddenError('Only Owner/Manager/Admin can assign sales person');
      }
      const nextAssignedSalesId = String(payload.assignedSalesId || '').trim();
      if (!nextAssignedSalesId) {
        data.assignedSalesId = null;
      } else {
        const salesUser = await this.userRepo.findById(nextAssignedSalesId);
        if (!salesUser || String(salesUser.role?.name || '').toLowerCase() !== 'sales') {
          throw new BadRequestError('Assigned user must be an active Sales user');
        }
        data.assignedSalesId = String(salesUser.id);
      }
    }

    if (payload.status != null) {
      const st = String(payload.status).toUpperCase();
      const allowed: InquiryStatus[] = ['OPEN', 'LOCKED', 'CLOSED'];
      if (!allowed.includes(st as InquiryStatus)) {
        throw new BadRequestError('Invalid status');
      }
      data.status = st as InquiryStatus;
    }

    // If changing client/context fields, re-check duplicates (avoid parallel active inquiries)
    const nextPhone = data.phone ?? existing.phone;
    const nextEmail = data.email ?? existing.email;
    const nextCity = data.city ?? existing.city;
    const nextArea = data.area ?? existing.area;
    const nextLocation = data.location ?? existing.location;

    const dup = await this.repo.findPotentialDuplicate({
      phone: String(nextPhone),
      email: nextEmail ? String(nextEmail) : null,
      city: String(nextCity),
      area: String(nextArea),
      location: String(nextLocation),
    });

    if (dup && dup.id !== existing.id) {
      // Block creating conflicting/parallel inquiries
      throw new ConflictError(
        'An inquiry for this client already exists. Please contact the Owner to proceed.',
      );
    }

    const nextFollowupWasUpdated = Object.prototype.hasOwnProperty.call(data, 'nextFollowupDate');
    const shouldSendFollowupWhatsApp =
      nextFollowupWasUpdated &&
      !!data.nextFollowupDate &&
      new Date(String(data.nextFollowupDate)).getTime() !==
        new Date(String(existing.nextFollowupDate || '')).getTime();

    const updated = await this.repo.update(id, data as unknown as Record<string, unknown>);

    if (payload.interestedHoardings !== undefined) {
      const interestedHoardings = payload.interestedHoardings != null ? String(payload.interestedHoardings).trim() : null;
      await prisma.inquiryHoarding.deleteMany({
        where: { inquiryId: id }
      });
      if (interestedHoardings) {
        const codes = interestedHoardings.split(',').map(s => s.trim()).filter(Boolean);
        const hoardings = await prisma.hoarding.findMany({
          where: {
            OR: [
              { code: { in: codes } },
              { id: { in: codes } }
            ]
          },
          select: { id: true }
        });
        if (hoardings.length > 0) {
          await prisma.inquiryHoarding.createMany({
            data: hoardings.map((h: any) => ({
              inquiryId: id,
              hoardingId: h.id
            }))
          });
        }
      }
    }

    if (
      shouldSendFollowupWhatsApp &&
      updated.nextFollowupDate &&
      String(updated.phone || '').trim()
    ) {
      await this.sendFollowupWhatsAppMock({
        inquiryId: String(updated.id),
        actorUserId: user.id,
        phone: String(updated.phone || existing.phone || ''),
        clientName: String(updated.clientName || existing.clientName || ''),
        companyName: updated.companyName || null,
        followupDate: new Date(updated.nextFollowupDate),
      });
    }

    if (
      data.assignedSalesId &&
      String(data.assignedSalesId || '') !== String(existing.assignedSalesId || '')
    ) {
      await this.notifyAssignedSales({
        inquiryId: String(updated.id),
        clientName: String(updated.clientName || existing.clientName || ''),
        phone: String(updated.phone || existing.phone || ''),
        assignedSalesId: String(data.assignedSalesId),
        assignedSalesName: updated.assignedSales?.name || null,
        actorUserId: user.id,
        context: 'update',
      });
    }

    // Notify Owner/Manager when a Sales user changes inquiry status
    try {
      if (
        roleName === 'sales' &&
        data.status &&
        String(originalStatus).toUpperCase() !== String(data.status).toUpperCase()
      ) {
        const recipients = (await this.userRepo.findByRoles([
          'owner',
          'manager',
        ])) as unknown as Array<{ id: string }>;

        const recipientIds: string[] = Array.from(
          new Set((recipients || []).map((u) => String(u.id).trim()).filter((id) => id.length > 0)),
        );

        let salesName = 'Sales User';
        try {
          const me = await this.userRepo.findById(user.id);
          if (me?.name) salesName = String(me.name);
        } catch (_) {}

        const title = 'Inquiry Status Updated';
        const body = `${salesName} (sales) changed inquiry status for ${updated.clientName} (${updated.phone}) from ${String(
          originalStatus,
        )} to ${String(data.status)}.`;
        const link = '/enquiries';

        await this.notification.notifyUsersIdempotent(
          recipientIds,
          title,
          body,
          link,
          `INQUIRY_STATUS:${updated.id}:${String(originalStatus)}->${String(data.status)}`,
        );
      }
    } catch (_) {}

    return updated;
  }

  async list(
    params: QueryParams,
    user: AuthUserLite,
  ): Promise<{ inquiries: InquiryRow[]; total: number }> {
    const roleName = String(user?.role?.name || '').toLowerCase();

    const pageNum = Math.max(1, parseInt(String(params['page'] || '1'), 10) || 1);
    const parsedLimit = parseInt(String(params['limit'] || '50'), 10);
    const limitNum =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

    const skip = (pageNum - 1) * limitNum;
    const take = limitNum;

    const q = String(params['q'] || '').trim();
    const city = String(params['city'] || '').trim();
    const area = String(params['area'] || '').trim();
    const location = String(params['location'] || '').trim();
    const status = String(params['status'] || '')
      .trim()
      .toUpperCase();
    const assignedSalesId = String(params['assignedSalesId'] || '').trim();
    const assignedToMe = String(params['assignedToMe'] || '')
      .trim()
      .toLowerCase();
    const categoryId = String(params['categoryId'] || '').trim();
    const createdByRole = String(params['createdByRole'] || '')
      .trim()
      .toLowerCase();
    const performanceStage = String(params['performanceStage'] || '')
      .trim()
      .toUpperCase();

    const where: Record<string, unknown> = {};
    const and: Array<Record<string, unknown>> = [];

    if (categoryId) {
      and.push({ categoryId });
    }

    if (roleName === 'sales') {
      and.push({
        OR: [
          { assignedSalesId: user.id },
          {
            createdById: user.id,
            source: { in: SALES_IMMEDIATE_VISIBILITY_SOURCES },
          },
        ],
      });
    }

    if (roleName !== 'sales' && assignedSalesId) {
      and.push({ assignedSalesId });
    }

    if (assignedToMe === 'true') {
      and.push({ assignedSalesId: user.id });
    }

    if (q) {
      and.push({
        OR: [
          { clientName: { contains: q, mode: 'insensitive' } },
          { companyName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (city) and.push({ city: { contains: city, mode: 'insensitive' } });
    if (area) and.push({ area: { contains: area, mode: 'insensitive' } });
    if (location) and.push({ location: { contains: location, mode: 'insensitive' } });

    if (status) {
      const allowed: InquiryStatus[] = ['OPEN', 'LOCKED', 'CLOSED'];
      if (allowed.includes(status as InquiryStatus)) {
        and.push({ status });
      }
    }

    if (performanceStage) {
      const allowed: InquiryPerformanceStage[] = [
        'IN_PROCESS',
        'WON',
        'FOLLOW_UP_LATER',
        'DEAD',
        'NOT_INTERESTED',
      ];
      if (allowed.includes(performanceStage as InquiryPerformanceStage)) {
        and.push({ performanceStage });
      }
    }

    if (createdByRole) {
      if (roleName === 'sales' && createdByRole === 'sales') {
        // Sales cannot view other sales inquiries; keep to own.
        and.push({ createdById: user.id });
      } else {
        and.push({
          createdBy: { role: { name: { equals: createdByRole, mode: 'insensitive' } } },
        });
      }
    }

    if (and.length > 0) where['AND'] = and;

    return this.repo.list({ skip, take, where });
  }

  async assignSales(
    inquiryId: string,
    assignedSalesId: string | null,
    user: AuthUserLite,
  ): Promise<InquiryRow> {
    const roleName = String(user?.role?.name || '').toLowerCase();
    if (!canAssignSales(roleName)) {
      throw new ForbiddenError('Only Owner/Manager/Admin can assign sales person');
    }

    const existing = await this.repo.findById(inquiryId);
    if (!existing) throw new NotFoundError('Inquiry not found');

    let nextAssignedSalesId: string | null = null;
    if (assignedSalesId) {
      const salesUser = await this.userRepo.findById(String(assignedSalesId));
      if (!salesUser || String(salesUser.role?.name || '').toLowerCase() !== 'sales') {
        throw new BadRequestError('Assigned user must be an active Sales user');
      }
      nextAssignedSalesId = String(salesUser.id);
    }

    const updated = await this.repo.update(inquiryId, { assignedSalesId: nextAssignedSalesId });

    if (
      nextAssignedSalesId &&
      String(nextAssignedSalesId || '') !== String(existing.assignedSalesId || '')
    ) {
      await this.notifyAssignedSales({
        inquiryId: String(updated.id),
        clientName: String(updated.clientName || existing.clientName || ''),
        phone: String(updated.phone || existing.phone || ''),
        assignedSalesId: String(nextAssignedSalesId),
        assignedSalesName: updated.assignedSales?.name || null,
        actorUserId: user.id,
        context: 'assign',
      });
    }

    return updated;
  }

  async listSalesUsers() {
    type SalesUserLite = {
      id: string;
      name?: string | null;
      phone?: string | null;
      isActive?: boolean;
    };
    const users = ((await this.userRepo.findByRole('sales')) || []) as SalesUserLite[];
    return users
      .filter((u) => u?.isActive !== false)
      .map((u) => ({ id: String(u.id), name: String(u.name || ''), phone: u.phone || null }));
  }

  async listReminders(
    params: QueryParams,
    user: AuthUserLite,
  ): Promise<{ inquiries: InquiryRow[] }> {
    const roleName = String(user?.role?.name || '').toLowerCase();
    if (!['owner', 'manager', 'sales', 'admin'].includes(roleName)) {
      throw new ForbiddenError('Insufficient permissions');
    }

    const range = String(params['range'] || 'next7')
      .trim()
      .toLowerCase() as ReminderRange;
    const today = startOfToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const next7 = new Date(today);
    next7.setDate(today.getDate() + 7);
    const next7End = endOfDay(next7);

    const and: Array<Record<string, unknown>> = [
      { followupStatus: 'PENDING' },
      { nextFollowupDate: { gte: today } },
    ];

    if (range === 'today') {
      and.push({ nextFollowupDate: { lt: tomorrow } });
    } else if (range === 'next7') {
      and.push({ nextFollowupDate: { lte: next7End } });
    }

    if (roleName === 'sales') {
      and.push({ assignedSalesId: user.id });
    }

    const where: Record<string, unknown> = { AND: and };
    const inquiries = await this.repo.listReminders(where);
    return { inquiries };
  }
}

export default new InquiryService();
