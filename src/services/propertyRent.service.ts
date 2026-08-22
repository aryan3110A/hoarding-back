import { Prisma, PropertyRent, PaymentFrequency, User, IncrementType } from '@prisma/client';
import { PropertyRentRepository } from '../repositories/propertyRent.repository';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';

type IncrementMode = 'AUTO' | 'MANUAL';

type ManualIncrementInput = {
  year: number;
  type: IncrementType;
  value: number | string;
};

type ManualIncrement = {
  year: number;
  type: IncrementType;
  value: number;
};

interface SavePropertyRentInput {
  propertyGroupId?: string;
  location?: string;
  rentAmount: number | string;
  incrementCycleYears?: number; // 1..5
  incrementType?: IncrementType; // PERCENTAGE | AMOUNT
  incrementValue?: number | string; // percent or amount
  incrementMode?: IncrementMode; // AUTO | MANUAL
  manualIncrements?: ManualIncrementInput[];
  rentStartDate?: string; // ISO date; required for fixed cycle calculation
  paymentFrequency: PaymentFrequency;
  lastPaymentDate?: string; // ISO
  reminderDays?: number[]; // e.g. [7,14]
  landlordName: string;
}

export class PropertyRentService {
  private repo: PropertyRentRepository;
  private notificationService: NotificationService;
  private userRepository: UserRepository;

  constructor() {
    this.repo = new PropertyRentRepository();
    this.notificationService = new NotificationService();
    this.userRepository = new UserRepository();
  }

  private normalizeLandlordName(landlordName: string) {
    return String(landlordName || '').trim();
  }

  private buildLandlordKey(landlordName: string) {
    const normalized = this.normalizeLandlordName(landlordName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const fallback = normalized || 'unknown_landlord';
    const key = `LANDLORD_${fallback}`;
    return key.slice(0, 100);
  }

  private normalizeIncrementMode(value: unknown): IncrementMode {
    return String(value || 'AUTO').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'AUTO';
  }

  private normalizeManualIncrements(items: ManualIncrementInput[] = []): ManualIncrement[] {
    const byYear = new Map<number, ManualIncrement>();

    for (const item of items) {
      const year = Number(item?.year || 0);
      const type = String(item?.type || '').toUpperCase() === 'AMOUNT' ? 'AMOUNT' : 'PERCENTAGE';
      const value = Number(item?.value ?? 0);

      if (!Number.isFinite(year) || year < 2 || year > 5) continue;
      if (!Number.isFinite(value)) continue;

      byYear.set(year, {
        year,
        type,
        value: Math.max(0, value),
      });
    }

    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }

  private readManualSchedule(record: PropertyRent): ManualIncrement[] {
    const rawSchedule = (record as unknown as { incrementSchedule?: unknown }).incrementSchedule;
    if (!rawSchedule || typeof rawSchedule !== 'object') return [];

    const schedule = rawSchedule as {
      mode?: unknown;
      manualIncrements?: unknown;
    };

    if (String(schedule.mode || '').toUpperCase() !== 'MANUAL') {
      return [];
    }

    if (!Array.isArray(schedule.manualIncrements)) {
      return [];
    }

    return this.normalizeManualIncrements(schedule.manualIncrements as ManualIncrementInput[]);
  }

  private getContractYear(startDate: Date | null | undefined, referenceDate: Date) {
    if (!startDate) return 1;

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return 1;

    let years = referenceDate.getFullYear() - start.getFullYear();
    const monthDiff = referenceDate.getMonth() - start.getMonth();
    const dayDiff = referenceDate.getDate() - start.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      years -= 1;
    }

    return Math.min(Math.max(years + 1, 1), 5);
  }

  private applyIncrement(base: number, type: IncrementType, value: number) {
    if (type === 'AMOUNT') return base + value;
    return base + (base * value) / 100;
  }

  private addMonthsClamped(base: Date, months: number) {
    const next = new Date(base);
    const day = next.getDate();
    next.setMonth(next.getMonth() + months);
    if (next.getDate() < day) next.setDate(0);
    return next;
  }

  private addCycle(base: Date, freq: PaymentFrequency) {
    switch (freq) {
      case 'Monthly':
        return this.addMonthsClamped(base, 1);
      case 'Quarterly':
        return this.addMonthsClamped(base, 3);
      case 'HalfYearly':
        return this.addMonthsClamped(base, 6);
      case 'Yearly':
        return this.addMonthsClamped(base, 12);
      default:
        return this.addMonthsClamped(base, 1);
    }
  }

  private calculateFirstDueDate(rentStartDate: Date, freq: PaymentFrequency) {
    const start = new Date(rentStartDate);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestError('Invalid rentStartDate');
    }
    // First due = start of rent cycle. Do NOT skip past today — unpaid cycles must stay overdue.
    return start;
  }

  private startOfDay(value: Date) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private enrichDueRecord(row: PropertyRent & { hoardings?: any[] }, asOf = new Date()) {
    const due = row.nextDueDate ? new Date(row.nextDueDate) : null;
    const rentAmount = Number(row.rentAmount || 0);
    const paidCycle = Number((row as any).currentCyclePaidAmount || 0);
    const remaining = Math.max(0, rentAmount - paidCycle);
    const today = this.startOfDay(asOf);
    let paymentStatus: 'Upcoming' | 'Due Today' | 'Overdue' | 'Partial' | 'Paid' = 'Upcoming';
    let overdueDays = 0;

    if (!due) {
      paymentStatus = 'Upcoming';
    } else {
      const dueDay = this.startOfDay(due);
      if (remaining <= 0) {
        paymentStatus = 'Paid';
      } else if (dueDay.getTime() < today.getTime()) {
        paymentStatus = paidCycle > 0 ? 'Partial' : 'Overdue';
        overdueDays = Math.floor((today.getTime() - dueDay.getTime()) / 86400000);
      } else if (dueDay.getTime() === today.getTime()) {
        paymentStatus = paidCycle > 0 ? 'Partial' : 'Due Today';
      } else {
        paymentStatus = paidCycle > 0 ? 'Partial' : 'Upcoming';
      }
    }

    return {
      ...row,
      rentAmount,
      currentDueAmount: remaining,
      paidAmount: paidCycle,
      overdueDays,
      paymentStatus,
      linkedHoardings: (row.hoardings || []).map((h: any) => ({
        id: h.id,
        code: h.code,
        city: h.city,
        landmark: h.landmark,
        area: h.area,
      })),
    };
  }

  private dedupeByLandlord(rows: PropertyRent[]) {
    const byLandlord = new Map<string, PropertyRent>();
    for (const row of rows) {
      const landlordKey = this.normalizeLandlordName(String(row.landlord || '')).toLowerCase();
      const key = landlordKey || `group:${row.propertyGroupId}`;
      const existing = byLandlord.get(key);
      if (!existing || new Date(row.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        byLandlord.set(key, row);
      }
    }
    return Array.from(byLandlord.values());
  }

  // Accept optional actor (authenticated user) so notifications can exclude the actor
  async save(
    data: SavePropertyRentInput,
    actor?: User & { role: { name: string } },
  ): Promise<PropertyRent> {
    const {
      propertyGroupId,
      location,
      rentAmount,
      incrementCycleYears = 1,
      incrementType = 'PERCENTAGE',
      incrementValue,
      incrementMode = 'AUTO',
      manualIncrements = [],
      rentStartDate,
      paymentFrequency,
      lastPaymentDate,
      reminderDays = [14],
      landlordName,
    } = data;

    const normalizedLandlord = this.normalizeLandlordName(landlordName);
    const normalizedIncrementMode = this.normalizeIncrementMode(incrementMode);
    const normalizedManualIncrements = this.normalizeManualIncrements(manualIncrements);
    if (!normalizedLandlord) {
      throw new BadRequestError('landlordName is required');
    }

    const existingByLandlord = await this.repo.findByLandlord(normalizedLandlord);
    const existingByGroup = propertyGroupId ? await this.repo.findByGroupId(propertyGroupId) : null;
    const existing = existingByLandlord || existingByGroup;

    const lastPaid = lastPaymentDate ? new Date(lastPaymentDate) : existing?.lastPaymentDate || undefined;
    const startDate = rentStartDate
      ? new Date(rentStartDate)
      : existing?.rentStartDate
        ? new Date(existing.rentStartDate)
        : undefined;
    if (!startDate) {
      throw new BadRequestError('rentStartDate is required for fixed due cycle calculation');
    }
    // Preserve unpaid due date on config updates. Only seed first due on create.
    const nextDueDate =
      existing?.nextDueDate != null
        ? new Date(existing.nextDueDate)
        : this.calculateFirstDueDate(startDate, paymentFrequency);

    const landlordScopedGroupId = String(
      propertyGroupId || existing?.propertyGroupId || this.buildLandlordKey(normalizedLandlord),
    );

    const rentDecimal = new Prisma.Decimal(rentAmount);
    const incrementValueDecimal =
      incrementValue != null ? new Prisma.Decimal(incrementValue) : undefined;

    // Compute nextIncrementDate based on rentStartDate and cycle years
    let nextIncrementDate: Date | undefined = undefined;
    if (startDate) {
      nextIncrementDate = new Date(startDate);
      nextIncrementDate.setFullYear(
        nextIncrementDate.getFullYear() +
          (normalizedIncrementMode === 'MANUAL' ? 1 : incrementCycleYears || 1),
      );
    }

    const payload: Prisma.PropertyRentCreateInput | Prisma.PropertyRentUpdateInput = {
      propertyGroupId: landlordScopedGroupId,
      location,
      landlord: normalizedLandlord,
      rentAmount: rentDecimal,
      incrementCycleYears,
      paymentFrequency,
      lastPaymentDate: lastPaid,
      nextDueDate,
      incrementRate: new Prisma.Decimal(0.1),
      reminderDays,
      baseRent: rentDecimal,
      rentStartDate: startDate,
      incrementType,
      incrementValue: incrementValueDecimal,
      lastIncrementDate: undefined,
      nextIncrementDate,
    } as Prisma.PropertyRentCreateInput | Prisma.PropertyRentUpdateInput;

    (payload as unknown as { incrementSchedule?: unknown }).incrementSchedule =
      normalizedIncrementMode === 'MANUAL'
        ? {
            mode: 'MANUAL',
            horizonYears: 5,
            manualIncrements: normalizedManualIncrements,
          }
        : null;

    let result: PropertyRent;

    if (existing) {
      result = await this.repo.update(existing.id, payload as Prisma.PropertyRentUpdateInput);
    } else {
      result = await this.repo.create(payload as Prisma.PropertyRentCreateInput);
    }

    // Important: landlord rent configuration must not change hoarding operational status.

    // Notify relevant users (owner/manager/admin) about this change
    try {
      const targetRoles = ['owner', 'manager', 'admin'];
      const recipients = await this.userRepository.findByRoles(targetRoles);
      const filtered = recipients
        .filter((u: User) => !actor || u.id !== actor.id)
        .map((u: User) => u.id);
      if (filtered.length > 0) {
        const amount = Number(result.rentAmount);
        const formatted = isNaN(amount)
          ? String(result.rentAmount)
          : amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
        const title = existing
          ? `Landlord ${normalizedLandlord} rent updated`
          : `Landlord ${normalizedLandlord} placed on rent`;
        const body = `${actor ? actor.name : 'System'} ${existing ? 'updated' : 'placed on rent'} landlord ${normalizedLandlord}${result.location ? ` (${result.location})` : ''}. Current rent ₹${formatted}.`;
        const link = `/landlords/${encodeURIComponent(normalizedLandlord)}/rent`;
        await this.notificationService.notifyUsers(filtered, title, body, link);
      }
    } catch (err) {
      // Notification failures shouldn't block the main operation
      console.error('Failed to send property rent notifications', err);
    }

    return result;
  }

  async get(propertyGroupId: string) {
    const record = await this.repo.findByGroupId(propertyGroupId);
    if (!record) throw new NotFoundError('Property rent not found');
    return record;
  }

  async getByLandlord(landlordName: string) {
    const landlord = this.normalizeLandlordName(landlordName);
    if (!landlord) throw new BadRequestError('landlordName is required');
    const record = await this.repo.findByLandlord(landlord);
    if (!record) throw new NotFoundError('Landlord rent not found');
    return record;
  }

  async list(params: { skip?: number; take?: number } = {}) {
    const result = await this.repo.list(params);
    return {
      ...result,
      rows: this.dedupeByLandlord(result.rows),
    };
  }

  async upcoming(days: number) {
    const rows = await this.repo.upcomingDues(days);
    return rows.map((row: any) => this.enrichDueRecord(row));
  }

  async overdue() {
    const rows = await this.repo.overdueDues();
    return rows.map((row: any) => this.enrichDueRecord(row));
  }

  async dueBoard() {
    const all = this.dedupeByLandlord((await this.repo.list({})).rows as any[]);
    return all
      .filter((row) => !!row.nextDueDate)
      .map((row) => this.enrichDueRecord(row as any))
      .sort((a, b) => {
        const da = a.nextDueDate ? new Date(a.nextDueDate).getTime() : 0;
        const db = b.nextDueDate ? new Date(b.nextDueDate).getTime() : 0;
        return da - db;
      });
  }

  async recordPayment(input: {
    propertyRentId?: string;
    propertyGroupId?: string;
    landlordName?: string;
    amountPaid: number | string;
    paymentDate: string;
    paymentMode: string;
    remarks?: string;
    screenshotUrl?: string;
    screenshotPath?: string;
    recordedById?: string;
  }) {
    const amountPaid = Number(input.amountPaid);
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      throw new BadRequestError('amountPaid must be greater than 0');
    }
    if (!input.paymentDate) throw new BadRequestError('paymentDate is required');
    if (!String(input.paymentMode || '').trim()) {
      throw new BadRequestError('paymentMode is required');
    }

    let rent: PropertyRent | null = null;
    if (input.propertyRentId) {
      rent = await this.repo.findById(input.propertyRentId);
    } else if (input.propertyGroupId) {
      rent = await this.repo.findByGroupId(input.propertyGroupId);
    } else if (input.landlordName) {
      rent = await this.repo.findByLandlord(this.normalizeLandlordName(input.landlordName));
    }
    if (!rent) throw new NotFoundError('Property rent not found');
    if (!rent.nextDueDate) throw new BadRequestError('No current due date to pay against');

    const rentAmountDue = Number(rent.rentAmount || 0);
    const alreadyPaid = Number((rent as any).currentCyclePaidAmount || 0);
    const remainingBefore = Math.max(0, rentAmountDue - alreadyPaid);
    if (remainingBefore <= 0) {
      throw new BadRequestError('Current rent cycle is already fully paid');
    }

    const applied = Math.min(amountPaid, remainingBefore);
    const newPaidTotal = alreadyPaid + applied;
    const fullyPaid = newPaidTotal + 0.0001 >= rentAmountDue;
    const paymentDate = new Date(input.paymentDate);

    const payment = await this.repo.createPayment({
      propertyRentId: rent.id,
      landlord: rent.landlord || null,
      dueDate: rent.nextDueDate,
      rentAmountDue: new Prisma.Decimal(rentAmountDue),
      amountPaid: new Prisma.Decimal(applied),
      paymentDate,
      paymentMode: String(input.paymentMode).trim(),
      remarks: input.remarks ? String(input.remarks).trim() : null,
      screenshotUrl: input.screenshotUrl || null,
      screenshotPath: input.screenshotPath || null,
      recordedById: input.recordedById || null,
    });

    const updateData: Prisma.PropertyRentUpdateInput = {
      lastPaymentDate: paymentDate,
      currentCyclePaidAmount: new Prisma.Decimal(fullyPaid ? 0 : newPaidTotal),
    };

    if (fullyPaid) {
      // Advance ONLY after full payment for the current unpaid cycle.
      updateData.nextDueDate = this.addCycle(new Date(rent.nextDueDate), rent.paymentFrequency);
    }

    const updated = await this.repo.update(rent.id, updateData);
    return {
      payment,
      rent: this.enrichDueRecord(updated as any),
      fullyPaid,
      amountApplied: applied,
      remainingAmount: fullyPaid ? 0 : Math.max(0, rentAmountDue - newPaidTotal),
    };
  }

  async paymentTotals(asOf = new Date()) {
    const startOfToday = this.startOfDay(asOf);
    const endOfToday = new Date(startOfToday);
    endOfToday.setHours(23, 59, 59, 999);

    const startOfWeek = new Date(startOfToday);
    const day = startOfWeek.getDay(); // 0 Sun
    const diffToMon = day === 0 ? 6 : day - 1;
    startOfWeek.setDate(startOfWeek.getDate() - diffToMon);

    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);
    const endOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth() + 1, 0, 23, 59, 59, 999);

    const [paidToday, paidWeek, paidMonth, overdueRows, upcomingRows] = await Promise.all([
      this.repo.sumPaymentsBetween(startOfToday, endOfToday),
      this.repo.sumPaymentsBetween(startOfWeek, endOfToday),
      this.repo.sumPaymentsBetween(startOfMonth, endOfMonth),
      this.overdue(),
      this.upcoming(30),
    ]);

    const overdueTotal = overdueRows.reduce(
      (sum: number, r: any) => sum + Number(r.currentDueAmount || 0),
      0,
    );
    const upcomingTotal = upcomingRows.reduce(
      (sum: number, r: any) => sum + Number(r.currentDueAmount || 0),
      0,
    );

    return {
      totalRentPaidToday: paidToday,
      totalRentPaidThisWeek: paidWeek,
      totalRentPaidThisMonth: paidMonth,
      totalOverdueRent: overdueTotal,
      totalUpcomingRentDue: upcomingTotal,
      overdueCount: overdueRows.length,
      upcomingCount: upcomingRows.length,
    };
  }

  // Compute expected next rent based on compounding rules
  computeNextRent(r: PropertyRent, targetYear?: number) {
    const current = Number(r.baseRent ?? r.rentAmount);

    const manualSchedule = this.readManualSchedule(r);
    if (manualSchedule.length > 0) {
      const year = Math.min(Math.max(Number(targetYear || 2), 2), 5);
      const rule = manualSchedule.find((item) => item.year === year);
      if (!rule) return current;
      return this.applyIncrement(current, rule.type, rule.value);
    }

    if (!r.incrementType || r.incrementValue == null) return current;
    const incVal = Number(r.incrementValue);
    return this.applyIncrement(current, r.incrementType, incVal);
  }

  // Apply increments for records whose nextIncrementDate is due
  async applyDueIncrements(today = new Date()) {
    const due = await this.repo.list({});
    let count = 0;
    for (const r of due.rows) {
      if (r.nextIncrementDate && new Date(r.nextIncrementDate) <= today) {
        const currentIncrementDate = new Date(r.nextIncrementDate);
        const contractYear = this.getContractYear(r.rentStartDate || null, currentIncrementDate);
        const next = this.computeNextRent(r, contractYear);

        const manualSchedule = this.readManualSchedule(r);
        const isManual = manualSchedule.length > 0;

        let nextDate: Date | null = null;
        if (isManual) {
          if (contractYear < 5) {
            nextDate = new Date(currentIncrementDate);
            nextDate.setFullYear(nextDate.getFullYear() + 1);
          }
        } else {
          nextDate = new Date(currentIncrementDate);
          nextDate.setFullYear(nextDate.getFullYear() + (r.incrementCycleYears || 1));
        }

        await this.repo.update(r.id, {
          baseRent: new Prisma.Decimal(next),
          lastIncrementDate: r.nextIncrementDate,
          nextIncrementDate: nextDate,
        });
        count++;
      }
    }
    return count;
  }

  annualizeAmount(rent: PropertyRent) {
    const base = Number(rent.rentAmount);
    switch (rent.paymentFrequency) {
      case 'Monthly':
        return base * 12;
      case 'Quarterly':
        return base * 4;
      case 'HalfYearly':
        return base * 2;
      case 'Yearly':
        return base;
      default:
        return base;
    }
  }

  async summary() {
    const all = this.dedupeByLandlord((await this.repo.list({})).rows);
    const totalProperties = all.length;
    let annualized = 0;
    for (const r of all) annualized += this.annualizeAmount(r);
    const monthlyLoad = annualized / 12;
    const upcoming14 = await this.upcoming(14);
    const overdue = await this.overdue();
    const paymentTotals = await this.paymentTotals();
    return {
      totalProperties,
      monthlyLoad,
      annualizedRent: annualized,
      upcoming14,
      overdue,
      ...paymentTotals,
    };
  }
}
