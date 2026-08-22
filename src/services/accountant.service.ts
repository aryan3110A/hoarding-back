import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';
import { BillingEventService } from './billingEvent.service';

const toNumber = (value: Prisma.Decimal | number | string | null | undefined) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
};

export class AccountantService {
  private notification: NotificationService;
  private userRepo: UserRepository;
  private billingEvents: BillingEventService;

  constructor() {
    this.notification = new NotificationService();
    this.userRepo = new UserRepository();
    this.billingEvents = new BillingEventService();
  }

  async getSummary() {
    const billingSummary = await this.billingEvents.getQueueSummary();
    const [invoiceAgg, paymentAgg, printingAgg] = await prisma.$transaction([
      prisma.invoice.aggregate({
        _sum: { totalAmount: true, paidAmount: true },
        _count: { id: true },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.printingExpense.aggregate({
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const totalBilled = toNumber(invoiceAgg._sum.totalAmount);
    const totalPaid = toNumber(invoiceAgg._sum.paidAmount);
    const outstanding = Math.max(0, totalBilled - totalPaid);

    return {
      invoicesCount: invoiceAgg._count.id || 0,
      paymentsCount: paymentAgg._count.id || 0,
      printingExpenseCount: printingAgg._count.id || 0,
      totalBilled,
      totalPaid,
      outstanding,
      totalPayments: toNumber(paymentAgg._sum.amount),
      totalPrintingExpense: toNumber(printingAgg._sum.amount),
      billingQueue: billingSummary,
    };
  }

  async getBillingQueue(params?: { tab?: string; clientId?: string }) {
    return this.billingEvents.listQueue(params);
  }

  async markBillingEventPoPending(eventId: string) {
    return this.billingEvents.markPoPending(eventId);
  }

  async generateBill(
    payload: {
      eventIds: string[];
      firmName: string;
      billNumber: string;
      remarks?: string;
    },
    actorId: string,
    billPdfPath?: string | null,
  ) {
    return this.billingEvents.generateInvoiceForEvents(payload, actorId, billPdfPath);
  }

  async listFirmOptions() {
    return this.billingEvents.listFirmOptions();
  }

  async listInvoices(params: {
    page?: number;
    limit?: number;
    status?: string;
    clientId?: string;
    contractId?: string;
    search?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.clientId) where.clientId = params.clientId;
    if (params.contractId) where.contractId = params.contractId;

    if (params.search) {
      const q = params.search.trim();
      if (q) {
        where.OR = [
          { invoiceNumber: { contains: q, mode: 'insensitive' } },
          { client: { name: { contains: q, mode: 'insensitive' } } },
          { contract: { contractNumber: { contains: q, mode: 'insensitive' } } },
        ];
      }
    }

    const [rows, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        include: {
          client: true,
          contract: true,
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  async createInvoice(
    payload: {
      clientId: string;
      contractId?: string;
      issueDate?: string;
      dueDate?: string;
      subtotal: number;
      taxAmount?: number;
      totalAmount?: number;
      status?: string;
      notes?: string;
    },
    actorId: string,
  ) {
    if (!payload.clientId) throw new BadRequestError('clientId is required');
    if (!payload.subtotal && payload.subtotal !== 0)
      throw new BadRequestError('subtotal is required');

    const subtotal = new Prisma.Decimal(payload.subtotal || 0);
    const taxAmount = new Prisma.Decimal(payload.taxAmount || 0);
    const totalAmount =
      payload.totalAmount !== undefined
        ? new Prisma.Decimal(payload.totalAmount)
        : subtotal.plus(taxAmount);

    if (subtotal.lessThanOrEqualTo(0)) throw new BadRequestError('subtotal must be > 0');
    if (totalAmount.lessThanOrEqualTo(0)) throw new BadRequestError('totalAmount must be > 0');

    const invoiceNumber = `INV-${Date.now()}`;

    const created = await prisma.invoice.create({
      data: {
        invoiceNumber,
        clientId: payload.clientId,
        contractId: payload.contractId || null,
        issueDate: payload.issueDate ? new Date(payload.issueDate) : undefined,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
        subtotal,
        taxAmount,
        totalAmount,
        status: payload.status || 'ISSUED',
        notes: payload.notes || null,
        createdById: actorId,
      },
    });

    try {
      const recipients = (await this.userRepo.findByRoles(['owner', 'manager', 'admin'])) as Array<{
        id?: string;
      }>;
      const ids = recipients.map((u) => u.id).filter((id): id is string => Boolean(id));
      if (ids.length > 0) {
        await this.notification.notifyUsersIdempotent(
          ids,
          'Invoice Created',
          `Invoice ${created.invoiceNumber} created for client ${payload.clientId}.`,
          `/dashboard/accountant`,
          `INVOICE_CREATED:${created.id}`,
        );
      }
    } catch (_) {}

    return created;
  }

  async updateInvoice(id: string, payload: { status?: string; dueDate?: string; notes?: string }) {
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Invoice not found');

    return prisma.invoice.update({
      where: { id },
      data: {
        status: payload.status || undefined,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
        notes: payload.notes,
      },
    });
  }

  async recordPayment(
    invoiceId: string,
    payload: {
      amount: number;
      method: string;
      status?: string;
      reference?: string;
      paidAt?: string;
      notes?: string;
    },
    actorId: string,
  ) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError('Invoice not found');
    if (invoice.status === 'VOID') throw new BadRequestError('Cannot pay a void invoice');

    if (!payload.amount && payload.amount !== 0) throw new BadRequestError('amount is required');

    if (!payload.method) throw new BadRequestError('method is required');

    const amount = new Prisma.Decimal(payload.amount || 0);
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestError('amount must be > 0');

    const currentPaid = new Prisma.Decimal(invoice.paidAmount || 0);
    const totalAmount = new Prisma.Decimal(invoice.totalAmount || 0);
    const remainingAmount = totalAmount.minus(currentPaid);

    if (remainingAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestError('This bill is already fully paid');
    }

    if (amount.greaterThan(remainingAmount)) {
      throw new BadRequestError(
        `Payment amount cannot be greater than remaining amount of Rs ${remainingAmount.toFixed(2)}`,
      );
    }

    const newPaid = currentPaid.plus(amount);

    const nextStatus = newPaid.greaterThanOrEqualTo(totalAmount)
      ? 'PAID'
      : newPaid.greaterThan(0)
        ? 'PARTIALLY_PAID'
        : invoice.status;

    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId,
          amount,
          method: payload.method,
          status: payload.status || 'CONFIRMED',
          reference: payload.reference || null,
          paidAt: payload.paidAt ? new Date(payload.paidAt) : undefined,
          notes: payload.notes || null,
          createdById: actorId,
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaid,
          status: nextStatus,
        },
      }),
    ]);

    try {
      const recipients = (await this.userRepo.findByRoles(['owner', 'manager', 'admin'])) as Array<{
        id?: string;
      }>;
      const ids = recipients.map((u) => u.id).filter((id): id is string => Boolean(id));
      if (ids.length > 0) {
        await this.notification.notifyUsersIdempotent(
          ids,
          'Payment Recorded',
          `Payment recorded for invoice ${invoice.invoiceNumber}.`,
          `/dashboard/accountant`,
          `PAYMENT_RECORDED:${payment.id}`,
        );
      }
    } catch (_) {}

    return payment;
  }

  async listPayments(params: { page?: number; limit?: number; invoiceId?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.invoiceId) where.invoiceId = params.invoiceId;

    const [rows, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: {
          invoice: {
            include: {
              client: true,
              contract: true,
            },
          },
        },
        orderBy: { paidAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  async getPaymentTrackingOverview(params?: { search?: string }) {
    const search = String(params?.search || '')
      .trim()
      .toLowerCase();
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { not: 'VOID' },
      },
      include: {
        client: true,
        contract: true,
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const grouped = new Map<string, any>();
    const today = new Date();

    for (const invoice of invoices) {
      const totalAmount = toNumber(invoice.totalAmount);
      const paidAmount = toNumber(invoice.paidAmount);
      const remainingAmount = Math.max(0, totalAmount - paidAmount);
      const partyName =
        invoice.client.billingCompanyName || invoice.client.companyName || invoice.client.name;
      const clientName = invoice.client.name;
      const lastPayment = (invoice.payments || [])[0] || null;
      const createdDate = invoice.createdAt || invoice.issueDate;
      const daysDue = createdDate
        ? Math.max(
            0,
            Math.floor((today.getTime() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)),
          )
        : 0;

      const searchable = [
        partyName,
        clientName,
        invoice.invoiceNumber,
        invoice.billingFirm,
        invoice.client.gstin,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      if (search && !searchable.includes(search)) {
        continue;
      }

      const bucket = grouped.get(invoice.clientId) || {
        clientId: invoice.clientId,
        partyName,
        clientName,
        partyDetails: {
          billingCompanyName:
            invoice.client.billingCompanyName || invoice.client.companyName || null,
          gstin: invoice.client.gstin || null,
          billingPhone: invoice.client.billingPhone || invoice.client.phone || null,
          billingEmail: invoice.client.billingEmail || invoice.client.email || null,
          billingAddress: invoice.client.billingAddress || null,
        },
        totalPendingAmount: 0,
        bills: [],
      };

      bucket.totalPendingAmount += remainingAmount;
      bucket.bills.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        billNumber: invoice.invoiceNumber,
        billCreatedDate: invoice.createdAt,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalAmount,
        paidAmount,
        remainingAmount,
        daysDue,
        status: invoice.status,
        billColor: remainingAmount > 0 ? 'red' : 'green',
        lastPaymentReceivedDate: lastPayment?.paidAt || null,
        reminderAt: invoice.reminderAt,
        reminderNote: invoice.reminderNote,
        lastReminderSentAt: invoice.lastReminderSentAt,
        firm: invoice.billingFirm,
        contractNumber: invoice.contract?.contractNumber || null,
        notes: invoice.notes || null,
        paymentHistory: (invoice.payments || []).map((payment: any) => ({
          id: payment.id,
          amount: toNumber(payment.amount),
          method: payment.method,
          status: payment.status,
          reference: payment.reference || null,
          paidAt: payment.paidAt,
          notes: payment.notes || null,
        })),
      });

      grouped.set(invoice.clientId, bucket);
    }

    return {
      groups: Array.from(grouped.values())
        .map((group) => ({
          ...group,
          bills: (group.bills || []).sort((a: any, b: any) =>
            String(a.invoiceNumber).localeCompare(String(b.invoiceNumber)),
          ),
        }))
        .sort((a, b) => String(a.partyName).localeCompare(String(b.partyName))),
    };
  }

  async scheduleInvoiceReminder(
    invoiceId: string,
    payload: { reminderAt: string; reminderNote?: string },
  ) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');

    const totalAmount = toNumber(invoice.totalAmount);
    const paidAmount = toNumber(invoice.paidAmount);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);
    if (remainingAmount <= 0) {
      throw new BadRequestError('Reminder can only be scheduled for pending bills');
    }

    const reminderAt = new Date(payload.reminderAt);
    if (Number.isNaN(reminderAt.getTime())) {
      throw new BadRequestError('Valid reminder date is required');
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    reminderAt.setHours(9, 0, 0, 0);
    if (reminderAt.getTime() < startOfToday.getTime()) {
      throw new BadRequestError('Reminder date cannot be in the past');
    }

    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        reminderAt,
        reminderNote: payload.reminderNote ? String(payload.reminderNote).trim() || null : null,
      },
      include: {
        client: true,
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });
  }

  async sendDueInvoiceReminders() {
    const now = new Date();
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        reminderAt: { lte: now },
      },
      include: { client: true },
    });

    let sent = 0;
    for (const invoice of invoices) {
      const totalAmount = toNumber(invoice.totalAmount);
      const paidAmount = toNumber(invoice.paidAmount);
      const remainingAmount = Math.max(0, totalAmount - paidAmount);
      if (remainingAmount <= 0) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { reminderAt: null, reminderNote: null },
        });
        continue;
      }

      const recipients = (await this.userRepo.findByRoles([
        'accountant',
        'owner',
        'manager',
        'admin',
      ])) as Array<{ id?: string }>;
      const ids = recipients.map((user) => String(user.id || '')).filter(Boolean);
      if (ids.length > 0) {
        const partyName =
          invoice.client.billingCompanyName || invoice.client.companyName || invoice.client.name;
        await this.notification.notifyUsersIdempotent(
          ids,
          'Payment reminder due',
          `Payment reminder due for ${partyName}, Bill ${invoice.invoiceNumber}. Remaining amount Rs ${remainingAmount.toFixed(2)}.`,
          '/dashboard/accountant',
          `INVOICE_REMINDER_DUE:${invoice.id}:${invoice.reminderAt?.toISOString() || 'na'}`,
        );
      }

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          lastReminderSentAt: now,
          reminderAt: null,
        },
      });
      sent += 1;
    }

    return { sent };
  }

  async listPrintingExpenses(params: {
    page?: number;
    limit?: number;
    contractId?: string;
    clientId?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.contractId) where.contractId = params.contractId;
    if (params.clientId) where.clientId = params.clientId;

    const [rows, total] = await prisma.$transaction([
      prisma.printingExpense.findMany({
        where,
        include: { client: true, contract: true },
        orderBy: { incurredOn: 'desc' },
        skip,
        take: limit,
      }),
      prisma.printingExpense.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  async createPrintingExpense(
    payload: {
      contractId?: string;
      clientId?: string;
      description: string;
      amount: number;
      incurredOn?: string;
      vendor?: string;
      notes?: string;
    },
    actorId: string,
  ) {
    if (!payload.description) throw new BadRequestError('description is required');
    if (!payload.amount && payload.amount !== 0) throw new BadRequestError('amount is required');

    const amount = new Prisma.Decimal(payload.amount || 0);
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestError('amount must be > 0');

    return prisma.printingExpense.create({
      data: {
        contractId: payload.contractId || null,
        clientId: payload.clientId || null,
        description: payload.description,
        amount,
        incurredOn: payload.incurredOn ? new Date(payload.incurredOn) : undefined,
        vendor: payload.vendor || null,
        notes: payload.notes || null,
        createdById: actorId,
      },
    });
  }
}
