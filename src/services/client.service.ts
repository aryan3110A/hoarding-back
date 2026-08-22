import { BadRequestError, ConflictError } from '../lib/errors';
import { ClientRepository, ClientCreateInput } from '../repositories/client.repository';
import { prisma } from '../lib/prisma';

export type ClientInput = {
  name: string;
  phone: string;
  email?: string;
  companyName?: string;
};

export type ClientBillingProfileInput = {
  billingCompanyName?: string;
  billingPhone?: string;
  billingEmail?: string;
  gstin?: string;
  billingAddress?: string;
};

export class ClientService {
  private repo: ClientRepository;

  constructor() {
    this.repo = new ClientRepository();
  }

  private normalizePhone(phone: string): string {
    return String(phone || '')
      .replace(/\s+/g, '')
      .replace(/\D/g, '')
      .trim();
  }

  private validatePhone(phone: string) {
    if (!phone) throw new BadRequestError('Client phone is required');
    if (phone.length > 10) throw new BadRequestError('Phone must be at most 10 digits');
  }

  async findOrCreate(
    input: ClientInput,
    createdBy?: string,
  ): Promise<{ id: string; name: string; phone: string } & Record<string, unknown>> {
    const name = String(input.name || '').trim();
    const phone = this.normalizePhone(input.phone);
    const email = input.email ? String(input.email).trim() : undefined;
    const companyName = input.companyName ? String(input.companyName).trim() : undefined;

    if (!name) throw new BadRequestError('Client name is required');
    this.validatePhone(phone);

    const existingUnknown = await this.repo.findByPhone(phone);
    const existing = existingUnknown as
      | null
      | ({
          id: string;
          name: string;
          phone: string;
          email?: string | null;
          companyName?: string | null;
        } & Record<string, unknown>);

    if (existing) {
      // Optionally enrich missing fields without overwriting existing values.
      const patch: Record<string, unknown> = {};
      if (name && (!existing.name || String(existing.name).trim().length === 0)) patch.name = name;
      if (email && (!existing.email || String(existing.email).trim().length === 0))
        patch.email = email;
      if (
        companyName &&
        (!existing.companyName || String(existing.companyName).trim().length === 0)
      )
        patch.companyName = companyName;

      if (Object.keys(patch).length > 0) {
        await this.repo.update(existing.id, patch as any);
      }

      return { ...existing, name: existing.name || name, phone: existing.phone || phone };
    }

    const createdUnknown = await this.repo.create({
      name,
      phone,
      email: email || null,
      companyName: companyName || null,
      createdById: createdBy || null,
    } as ClientCreateInput);

    const created = createdUnknown as { id: string; name: string; phone: string } & Record<
      string,
      unknown
    >;
    return created;
  }

  async createUnique(
    input: ClientInput,
    createdBy?: string,
  ): Promise<{ id: string; name: string; phone: string } & Record<string, unknown>> {
    const name = String(input.name || '').trim();
    const phone = this.normalizePhone(input.phone);
    const email = input.email ? String(input.email).trim() : undefined;
    const companyName = input.companyName ? String(input.companyName).trim() : undefined;

    if (!name) throw new BadRequestError('Client name is required');
    this.validatePhone(phone);

    const existing = await this.repo.findByPhone(phone);
    if (existing) throw new ConflictError('A client with this phone number already exists');

    const createdUnknown = await this.repo.create({
      name,
      phone,
      email: email || null,
      companyName: companyName || null,
      createdById: createdBy || null,
    } as ClientCreateInput);

    const created = createdUnknown as { id: string; name: string; phone: string } & Record<
      string,
      unknown
    >;
    return created;
  }

  async upsertBillingProfile(clientId: string, input: ClientBillingProfileInput) {
    if (!clientId) throw new BadRequestError('Client is required');
    const existingUnknown = await this.repo.findById(clientId);
    const existing = existingUnknown as Record<string, unknown> | null;
    if (!existing) throw new BadRequestError('Client not found');

    const patch: Record<string, unknown> = {};
    const fields: Array<keyof ClientBillingProfileInput> = [
      'billingCompanyName',
      'billingPhone',
      'billingEmail',
      'gstin',
      'billingAddress',
    ];

    for (const field of fields) {
      const rawValue = input[field];
      if (!rawValue) continue;
      const trimmed = String(rawValue).trim();
      if (!trimmed) continue;
      patch[field] = trimmed;
    }

    if (Object.keys(patch).length === 0) return existing;
    return this.repo.update(clientId, patch as Partial<ClientCreateInput>);
  }

  async getHistory(clientId: string) {
    const client = await this.repo.findById(clientId);
    if (!client) throw new BadRequestError('Client not found');

    const tokens = await prisma.bookingToken.findMany({
      where: { clientId },
      include: {
        hoarding: {
          select: { code: true, city: true, area: true, landmark: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    const contracts = await prisma.contract.findMany({
      where: { clientId },
      include: {
        renewedFrom: { select: { contractNumber: true } }
      },
      orderBy: { createdAt: 'desc' },
    });

    // 1. Total booked historically: non-cancelled/non-released tokens
    const totalBooked = tokens.filter((t: any) => !['CANCELLED', 'RELEASED'].includes(t.status)).length;

    // 2. Total continued/renewed: contracts that are renewals
    const totalRenewed = contracts.filter((c: any) => c.renewedFromId !== null).length;

    // 3. States breakdown:
    const activeCount = contracts.filter((c: any) => ['ACTIVE', 'EXPIRING_SOON'].includes(c.status)).length;
    const expiredCount = contracts.filter((c: any) => c.status === 'COMPLETED').length + tokens.filter((t: any) => t.status === 'EXPIRED').length;
    const blockedCount = tokens.filter((t: any) => ['BLOCKED', 'PENDING'].includes(t.status)).length;
    const unmountedCount = tokens.filter((t: any) => ['RELEASED', 'CANCELLED'].includes(t.status)).length + contracts.filter((c: any) => c.status === 'CANCELLED').length;

    // 4. Combine into single timeline
    const timeline: Array<{
      id: string;
      type: 'token' | 'contract';
      eventDate: Date;
      title: string;
      description: string;
      status: string;
      details: any;
    }> = [];

    for (const t of tokens) {
      timeline.push({
        id: t.id,
        type: 'token',
        eventDate: t.createdAt,
        title: `Booking Token: ${t.status}`,
        description: `Token requested for hoarding ${t.hoarding?.code || '—'} (${t.hoarding?.city || '—'})`,
        status: t.status,
        details: {
          hoardingCode: t.hoarding?.code,
          dateFrom: t.dateFrom,
          dateTo: t.dateTo,
          durationMonths: t.durationMonths,
          notes: t.notes,
        }
      });
    }

    for (const c of contracts) {
      timeline.push({
        id: c.id,
        type: 'contract',
        eventDate: c.createdAt,
        title: `Contract Created (${c.status})`,
        description: `Contract ${c.contractNumber} generated for hoarding ${c.hoardingCode || '—'}`,
        status: c.status,
        details: {
          contractNumber: c.contractNumber,
          startDate: c.startDate,
          endDate: c.endDate,
          durationMonths: c.durationMonths,
          basePrice: c.basePrice,
          totalValue: c.totalValue,
          renewedFrom: c.renewedFrom?.contractNumber,
        }
      });
    }

    timeline.sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());

    return {
      client,
      metrics: {
        totalBooked,
        totalRenewed,
        active: activeCount,
        expired: expiredCount,
        blocked: blockedCount,
        unmounted: unmountedCount,
      },
      timeline,
    };
  }
}
