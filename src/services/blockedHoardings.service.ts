import { prisma } from '../lib/prisma';
import { NotFoundError } from '../lib/errors';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';
import {
  blockQueueService,
  formatProposalRef,
  ACTIVE_BLOCK_STATUSES,
  type QueueEntryInfo,
} from './blockQueue.service';

export type BlockedQueueEntry = {
  tokenId: string;
  position: number;
  clientId: string;
  clientName: string;
  companyName: string | null;
  proposalId: string | null;
  proposalRef: string | null;
  salesUserId: string;
  salesUserName: string;
  addedAt: Date | null;
};

export type BlockedHoardingItem = {
  tokenId: string;
  hoardingId: string;
  code: string;
  location: string;
  size: string;
  companyName: string | null;
  proposalId: string | null;
  proposalRef: string | null;
  salesUserId: string | null;
  salesUserName: string | null;
  blockedAt: Date | null;
  blockExpiry: Date | null;
  queueCount: number;
  queue: BlockedQueueEntry[];
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

const mapQueue = (queue: QueueEntryInfo[]): BlockedQueueEntry[] =>
  queue.map((q) => ({
    tokenId: q.tokenId,
    position: q.position,
    clientId: q.clientId,
    clientName: q.clientName,
    companyName: q.companyName,
    proposalId: q.proposalId,
    proposalRef: q.proposalRef,
    salesUserId: q.salesUserId,
    salesUserName: q.salesUserName,
    addedAt: q.addedAt,
  }));

export class BlockedHoardingsService {
  /**
   * Active blocks grouped by client. Built from the SAME token data as the Proposal Builder and the
   * Hoarding Inventory (BlockQueueService), so a hoarding can never be "Blocked" in one place and
   * missing here. Only valid, unexpired ACTIVE blocks are listed - never queue entries, drafts,
   * expired or released tokens.
   */
  async listByClient(query?: { q?: string }): Promise<BlockedClientGroup[]> {
    if (!(await supportsPhase3BlockingSchema())) return [];
    const now = new Date();

    const active = (await prisma.bookingToken.findMany({
      where: {
        status: { in: [...ACTIVE_BLOCK_STATUSES] as any },
        expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        hoardingId: true,
        clientId: true,
        status: true,
        proposalId: true,
        salesUserId: true,
        blockedAt: true,
        expiresAt: true,
        createdAt: true,
        client: { select: { id: true, name: true, phone: true, companyName: true } },
        salesUser: { select: { id: true, name: true } },
        hoarding: {
          select: {
            id: true,
            code: true,
            city: true,
            area: true,
            landmark: true,
            widthCm: true,
            heightCm: true,
          },
        },
      },
    })) as unknown as Array<{
      id: string;
      hoardingId: string;
      clientId: string;
      status: string;
      proposalId: string | null;
      salesUserId: string;
      blockedAt: Date | null;
      expiresAt: Date;
      createdAt: Date;
      client: {
        id: string;
        name: string | null;
        phone: string | null;
        companyName: string | null;
      } | null;
      salesUser: { id: string; name: string | null } | null;
      hoarding: {
        id: string;
        code: string | null;
        city: string | null;
        area: string | null;
        landmark: string | null;
        widthCm: number | null;
        heightCm: number | null;
      } | null;
    }>;

    const infoMap = await blockQueueService.getBlockInfoMap(active.map((t) => t.hoardingId));
    const grouped = new Map<string, BlockedClientGroup>();

    for (const token of active) {
      const clientId = String(token.client?.id || token.clientId || '').trim();
      const hoardingId = String(token.hoarding?.id || token.hoardingId || '').trim();
      if (!clientId || !hoardingId) continue;

      if (!grouped.has(clientId)) {
        grouped.set(clientId, {
          clientId,
          clientName: String(token.client?.name || 'Unknown Client'),
          phone: String(token.client?.phone || 'N/A'),
          blockedCount: 0,
          hoardings: [],
        });
      }
      const group = grouped.get(clientId)!;
      const info = infoMap.get(hoardingId);

      group.hoardings.push({
        tokenId: String(token.id),
        hoardingId,
        code: String(token.hoarding?.code || hoardingId),
        location: toLocationLabel({
          city: token.hoarding?.city,
          area: token.hoarding?.area,
          landmark: token.hoarding?.landmark,
        }),
        size: toSizeLabel(token.hoarding?.widthCm, token.hoarding?.heightCm),
        companyName: token.client?.companyName || null,
        proposalId: token.proposalId || null,
        proposalRef: formatProposalRef(token.proposalId),
        salesUserId: token.salesUserId || null,
        salesUserName: token.salesUser?.name || null,
        blockedAt: token.blockedAt || token.createdAt || null,
        blockExpiry: token.expiresAt || null,
        queueCount: info?.queueCount ?? 0,
        queue: mapQueue(info?.queue || []),
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
        const matchesHoarding = row.hoardings.some(
          (h) =>
            String(h.code || '').toLowerCase().includes(q) ||
            String(h.companyName || '').toLowerCase().includes(q) ||
            String(h.salesUserName || '').toLowerCase().includes(q),
        );
        return name.includes(q) || phone.includes(q) || matchesHoarding;
      });
    }

    return result;
  }

  /** Active block + ordered waiting queue for one hoarding. */
  async getQueue(hoardingId: string) {
    const hoarding = await prisma.hoarding.findUnique({
      where: { id: hoardingId },
      select: { id: true, code: true, status: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    const info = await blockQueueService.getBlockInfo(hoardingId);
    return {
      hoardingId: hoarding.id,
      code: hoarding.code,
      active: info
        ? {
            tokenId: info.tokenId,
            clientId: info.clientId,
            clientName: info.clientName,
            companyName: info.companyName,
            proposalId: info.proposalId,
            proposalRef: info.proposalRef,
            salesUserId: info.salesUserId,
            salesUserName: info.salesUserName,
            blockedAt: info.blockedAt,
            expiresAt: info.expiresAt,
            status: info.status,
          }
        : null,
      queueCount: info?.queueCount ?? 0,
      queue: mapQueue(info?.queue || []),
    };
  }
}

export default new BlockedHoardingsService();
