import { prisma } from '../lib/prisma';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';

export type BlockedHoardingItem = {
  tokenId: string;
  hoardingId: string;
  code: string;
  location: string;
  size: string;
  blockedAt: Date | null;
  blockExpiry: Date | null;
  status: 'Blocked' | 'Extended Block';
};

export type BlockedClientGroup = {
  clientId: string;
  clientName: string;
  phone: string;
  blockedCount: number;
  hoardings: BlockedHoardingItem[];
};

const toSizeLabel = (widthCm?: number | null, heightCm?: number | null) => {
  if (!widthCm || !heightCm) return 'N/A';
  const w = Math.round(Number(widthCm) / 30.48);
  const h = Math.round(Number(heightCm) / 30.48);
  return `${w}ft x ${h}ft`;
};

const toLocationLabel = (row: {
  city?: string | null;
  area?: string | null;
  landmark?: string | null;
}) => {
  const parts = [row.city, row.area, row.landmark]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'N/A';
};

export class BlockedHoardingsService {
  async listByClient(query?: { q?: string }): Promise<BlockedClientGroup[]> {
    const now = new Date();
    const supportsPhase3 = await supportsPhase3BlockingSchema();
    const prismaUnsafe = prisma as unknown as {
      bookingToken: {
        findMany: (args: unknown) => Promise<unknown[]>;
      };
    };

    const activeBlockedStatuses = supportsPhase3
      ? (['BLOCKED', 'EXTENSION_REQUESTED'] as const)
      : (['ACTIVE'] as const);

    const where: Record<string, unknown> = {
      status: { in: activeBlockedStatuses },
      expiresAt: { gt: now },
      hoarding: { status: { in: ['blocked'] } },
    };

    if (supportsPhase3) {
      where['releasedAt'] = null;
    }

    const rows = (await prismaUnsafe.bookingToken.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        hoarding: {
          select: {
            id: true,
            code: true,
            city: true,
            area: true,
            landmark: true,
            widthCm: true,
            heightCm: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    })) as Array<{
      id: string;
      clientId?: string | null;
      status?: string | null;
      blockedAt?: Date | null;
      expiresAt?: Date | null;
      createdAt?: Date | null;
      client?: { id?: string | null; name?: string | null; phone?: string | null } | null;
      hoarding?: {
        id?: string | null;
        code?: string | null;
        city?: string | null;
        area?: string | null;
        landmark?: string | null;
        widthCm?: number | null;
        heightCm?: number | null;
        status?: string | null;
      } | null;
    }>;

    const seenClientHoarding = new Set<string>();
    const grouped = new Map<string, BlockedClientGroup>();

    for (const token of rows) {
      const clientId = String(token.client?.id || token.clientId || '').trim();
      const hoardingId = String(token.hoarding?.id || '').trim();
      if (!clientId || !hoardingId) continue;

      const dedupeKey = `${clientId}:${hoardingId}`;
      if (seenClientHoarding.has(dedupeKey)) continue;
      seenClientHoarding.add(dedupeKey);

      const clientName = String(token.client?.name || 'Unknown Client');
      const phone = String(token.client?.phone || 'N/A');

      if (!grouped.has(clientId)) {
        grouped.set(clientId, {
          clientId,
          clientName,
          phone,
          blockedCount: 0,
          hoardings: [],
        });
      }

      const group = grouped.get(clientId);
      if (!group) continue;
      group.hoardings.push({
        tokenId: String(token.id || ''),
        hoardingId,
        code: String(token.hoarding?.code || hoardingId),
        location: toLocationLabel({
          city: token.hoarding?.city,
          area: token.hoarding?.area,
          landmark: token.hoarding?.landmark,
        }),
        size: toSizeLabel(token.hoarding?.widthCm, token.hoarding?.heightCm),
        blockedAt: token.blockedAt || token.createdAt || null,
        blockExpiry: token.expiresAt || null,
        status:
          String(token.status || '').toUpperCase() === 'EXTENSION_REQUESTED'
            ? 'Extended Block'
            : 'Blocked',
      });
      group.blockedCount = group.hoardings.length;
    }

    let result = Array.from(grouped.values()).sort((a, b) =>
      String(a.clientName || '').localeCompare(String(b.clientName || '')),
    );

    const q = String(query?.q || '')
      .trim()
      .toLowerCase();
    if (q) {
      result = result.filter((row) => {
        const name = String(row.clientName || '').toLowerCase();
        const phone = String(row.phone || '').toLowerCase();
        return name.includes(q) || phone.includes(q);
      });
    }

    return result;
  }
}

export default new BlockedHoardingsService();
