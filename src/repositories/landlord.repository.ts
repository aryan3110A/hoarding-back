import { prisma } from '../lib/prisma';

type LandlordRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class LandlordRepository {
  private normalize(value: unknown) {
    return String(value || '').trim();
  }

  private extractRateHistoryLandlordNames(rateHistory: unknown): string[] {
    const names = new Set<string>();
    const landlordKeys = new Set([
      'landlord',
      'landlordname',
      'landlord_name',
      'landloard',
      'ownername',
      'owner_name',
    ]);

    const addName = (value: unknown) => {
      const name = this.normalize(value);
      if (name) names.add(name);
    };

    const walk = (node: unknown) => {
      if (!node) return;

      if (Array.isArray(node)) {
        node.forEach((item) => walk(item));
        return;
      }

      if (typeof node !== 'object') return;

      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        const normalizedKey = this.normalize(key).toLowerCase();
        if (landlordKeys.has(normalizedKey)) {
          addName(value);
        }

        if (value && typeof value === 'object') {
          walk(value);
        }
      }
    };

    walk(rateHistory);
    return Array.from(names);
  }

  async list(params: { q?: string; skip?: number; take?: number } = {}) {
    const { q, skip, take } = params;
    const query = String(q || '').trim();

    const where: Record<string, unknown> = query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, total] = await prisma.$transaction([
      prisma.landlord.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      prisma.landlord.count({ where }),
    ]);

    return { rows, total };
  }

  async listLegacyNamesByQuery(query: string, take = 50): Promise<string[]> {
    const q = this.normalize(query).toLowerCase();
    if (!q) return [];

    const names = new Set<string>();

    const propertyRents = await prisma.propertyRent.findMany({
      where: {
        landlord: {
          contains: q,
          mode: 'insensitive',
        },
      },
      select: {
        landlord: true,
      },
      orderBy: { updatedAt: 'desc' },
      take,
    });

    for (const row of propertyRents) {
      const landlordName = this.normalize(row.landlord);
      if (landlordName && landlordName.toLowerCase().includes(q)) {
        names.add(landlordName);
      }
    }

    const hoardings = await prisma.hoarding.findMany({
      where: {
        rateHistory: {
          not: null,
        },
      },
      select: {
        rateHistory: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });

    for (const hoarding of hoardings) {
      const extracted = this.extractRateHistoryLandlordNames(hoarding.rateHistory);
      for (const name of extracted) {
        if (name.toLowerCase().includes(q)) {
          names.add(name);
        }
      }
      if (names.size >= take) break;
    }

    return Array.from(names).slice(0, take);
  }

  async ensureByNames(names: string[]) {
    const uniqueNames = Array.from(
      new Set(names.map((name) => this.normalize(name)).filter(Boolean)),
    );

    for (const name of uniqueNames) {
      const existing = await prisma.landlord.findFirst({
        where: {
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });

      if (!existing) {
        await prisma.landlord.create({
          data: {
            name,
          },
        });
      }
    }
  }

  async listHoardingsForLandlordGrouping() {
    return prisma.hoarding.findMany({
      take: 5000,
      orderBy: [{ city: 'asc' }, { code: 'asc' }],
      include: {
        landlord: true,
        category: true,
      },
    });
  }

  async findById(id: string): Promise<LandlordRow | null> {
    return prisma.landlord.findUnique({ where: { id } }) as Promise<LandlordRow | null>;
  }

  async findDuplicate(name: string, phone?: string): Promise<LandlordRow | null> {
    const queryName = String(name || '').trim();
    const queryPhone = String(phone || '').trim();

    const filters: Record<string, unknown>[] = [
      {
        name: {
          equals: queryName,
          mode: 'insensitive',
        },
      },
    ];

    if (queryPhone) {
      filters.push({
        phone: {
          equals: queryPhone,
          mode: 'insensitive',
        },
      });
    }

    return prisma.landlord.findFirst({
      where: { OR: filters },
      orderBy: { updatedAt: 'desc' },
    }) as Promise<LandlordRow | null>;
  }

  async create(data: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  }): Promise<LandlordRow> {
    return prisma.landlord.create({ data }) as Promise<LandlordRow>;
  }
}
