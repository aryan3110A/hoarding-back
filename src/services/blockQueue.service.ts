import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { supportsPhase3BlockingSchema } from '../lib/dbCapabilities';

/**
 * Single source of truth for hoarding blocking.
 *
 * RULES (see "BLOCKING LOGIC FIXES" spec)
 *  - ONE HOARDING = MAXIMUM ONE ACTIVE BLOCK  (enforced here AND by a partial unique index in the DB)
 *  - Everyone else waits in a FIFO queue (same sales user or different sales user - no difference)
 *  - An active block lasts 48 hours; a client promoted from the queue gets a FRESH 48 hours
 *  - When the active block expires / is released, the next in queue is promoted automatically
 *  - When the active client books, the whole queue is closed
 *  - hoarding.status === 'blocked' is DERIVED from "has a valid, unexpired active block" - it is
 *    never set by hand, so every screen sees the same state.
 *
 * Token status mapping:
 *   BLOCKED / EXTENSION_REQUESTED -> ACTIVE BLOCK        PENDING  -> WAITING IN QUEUE
 *   EXPIRED -> EXPIRED      APPROVED -> BOOKED / CONVERTED      RELEASED / CANCELLED -> CLOSED
 */

export const BLOCK_DURATION_HOURS = 48;

/** Token statuses that mean "this token currently holds the block". ACTIVE is the pre-Phase-3 name. */
export const ACTIVE_BLOCK_STATUSES = ['BLOCKED', 'EXTENSION_REQUESTED'] as const;
const ACTIVE_LIKE_STATUSES = ['BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE'] as const;
export const HOLDING_STATUSES = [...ACTIVE_LIKE_STATUSES, 'PENDING'] as const;

/** Operational states - a hoarding in one of these can no longer be blocked / queued. */
export const OPERATIONAL_HOARDING_STATUSES = [
  'booked',
  'live',
  'under_process',
  'occupied',
  'removal_pending',
];
/** Only these hoarding statuses are controlled by the blocking logic. */
const BLOCK_CONTROLLED_STATUSES = ['available', 'blocked', 'tokenized', ''];

export type Tx = Prisma.TransactionClient;

export type QueueEntryInfo = {
  tokenId: string;
  /** 1-based position in the WAITING queue (the active block is not counted) */
  position: number;
  clientId: string;
  clientName: string;
  companyName: string | null;
  proposalId: string | null;
  proposalRef: string | null;
  salesUserId: string;
  salesUserName: string;
  addedAt: Date;
};

export type HoardingBlockInfo = {
  hoardingId: string;
  tokenId: string;
  status: 'BLOCKED' | 'EXTENSION_REQUESTED';
  clientId: string;
  clientName: string;
  companyName: string | null;
  proposalId: string | null;
  proposalRef: string | null;
  salesUserId: string;
  salesUserName: string;
  blockedAt: Date | null;
  expiresAt: Date;
  queueCount: number;
  queue: QueueEntryInfo[];
};

export type NormalizeResult = {
  headTokenId: string | null;
  headSalesUserId: string | null;
  headClientId: string | null;
  headPromoted: boolean;
  expired: Array<{ id: string; salesUserId: string }>;
  waitingTokenIds: string[];
};

export type SyncResult = { status: string; changed: boolean; hasActiveBlock: boolean };

export function formatProposalRef(proposalId?: string | null): string | null {
  const id = String(proposalId || '').trim();
  if (!id) return null;
  return `PR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

const lower = (v: unknown) =>
  String(v || '')
    .toLowerCase()
    .trim();
const upper = (v: unknown) =>
  String(v || '')
    .toUpperCase()
    .trim();

const isActiveStatus = (s: unknown) => (ACTIVE_LIKE_STATUSES as readonly string[]).includes(upper(s));

export class BlockQueueService {
  addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  /**
   * Serialise every blocking operation on one hoarding. The advisory lock is released
   * automatically when the surrounding transaction ends.
   */
  async lockHoarding(tx: Tx, hoardingId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hoardingId}))`;
  }

  async withHoardingLock<T>(hoardingId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (tx: Tx) => {
        await this.lockHoarding(tx, hoardingId);
        return fn(tx);
      },
      { timeout: 20000, maxWait: 20000 },
    );
  }

  /**
   * Re-computes the queue for ONE hoarding (call inside withHoardingLock):
   *   1. active blocks whose time is over are marked EXPIRED
   *   2. if several active blocks somehow exist, the oldest keeps it and the rest go back to the queue
   *   3. if nobody holds the block, the first waiting entry is promoted with a FRESH 48 hours
   *   4. everyone else keeps a gap-free FIFO position (active = 1, first waiting = 2, ...)
   */
  async normalizeQueue(tx: Tx, hoardingId: string, now: Date = new Date()): Promise<NormalizeResult> {
    const rows = await tx.bookingToken.findMany({
      where: { hoardingId, status: { in: [...HOLDING_STATUSES] as any } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        salesUserId: true,
        clientId: true,
        expiresAt: true,
        createdAt: true,
        queuePosition: true,
      },
    });

    const expired: Array<{ id: string; salesUserId: string }> = [];
    const alive: typeof rows = [];
    for (const row of rows) {
      if (isActiveStatus(row.status) && row.expiresAt && new Date(row.expiresAt) <= now) {
        expired.push({ id: row.id, salesUserId: row.salesUserId });
      } else {
        alive.push(row);
      }
    }

    if (expired.length > 0) {
      await tx.bookingToken.updateMany({
        where: { id: { in: expired.map((e) => e.id) } },
        data: {
          status: 'EXPIRED',
          extensionRequestedAt: null,
          extensionRequestedUntil: null,
        } as any,
      });
    }

    const activeRows = alive.filter((r) => isActiveStatus(r.status));
    let waiting = alive.filter((r) => !isActiveStatus(r.status));
    let head: (typeof alive)[number] | null = activeRows[0] || null;

    // Safety net: never more than one active block.
    const extraActive = activeRows.slice(1);
    if (extraActive.length > 0) {
      await tx.bookingToken.updateMany({
        where: { id: { in: extraActive.map((r) => r.id) } },
        data: {
          status: 'PENDING',
          blockedAt: null,
          extensionRequestedAt: null,
          extensionRequestedUntil: null,
        } as any,
      });
      waiting = [...extraActive, ...waiting].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.id.localeCompare(b.id),
      );
    }

    let headPromoted = false;
    if (!head && waiting.length > 0) {
      // Queue promotion: the promoted client gets a completely fresh 48-hour block.
      head = waiting.shift() as (typeof alive)[number];
      headPromoted = true;
      await tx.bookingToken.update({
        where: { id: head.id },
        data: {
          status: 'BLOCKED',
          queuePosition: 1,
          blockedAt: now,
          expiresAt: this.addHours(now, BLOCK_DURATION_HOURS),
          extensionRequestedAt: null,
          extensionRequestedUntil: null,
        } as any,
      });
    } else if (head) {
      const st = upper(head.status);
      const data: Record<string, unknown> = {};
      if (st === 'ACTIVE') {
        data.status = 'BLOCKED';
        data.blockedAt = head.createdAt;
      }
      if (head.queuePosition !== 1) data.queuePosition = 1;
      if (Object.keys(data).length > 0) {
        await tx.bookingToken.update({ where: { id: head.id }, data: data as any });
      }
    }

    // Gap-free FIFO positions for the waiting entries.
    for (let i = 0; i < waiting.length; i += 1) {
      const wanted = i + 2;
      if (waiting[i].queuePosition !== wanted || upper(waiting[i].status) !== 'PENDING') {
        await tx.bookingToken.update({
          where: { id: waiting[i].id },
          data: { queuePosition: wanted, status: 'PENDING' } as any,
        });
      }
    }

    return {
      headTokenId: head ? head.id : null,
      headSalesUserId: head ? head.salesUserId : null,
      headClientId: head ? head.clientId : null,
      headPromoted,
      expired,
      waitingTokenIds: waiting.map((w) => w.id),
    };
  }

  /**
   * hoarding.status 'blocked' is derived from the tokens:
   *  - valid, unexpired active block  -> 'blocked'
   *  - status says blocked/tokenized but there is no active block (expired, released, draft leftovers,
   *    manual edits) -> back to 'available'
   * Operational statuses (booked, live, under_process, ...) are never touched here.
   */
  async syncHoardingStatus(tx: Tx, hoardingId: string, now: Date = new Date()): Promise<SyncResult> {
    const hoarding = await tx.hoarding.findUnique({
      where: { id: hoardingId },
      select: { status: true },
    });
    if (!hoarding) return { status: '', changed: false, hasActiveBlock: false };

    const current = lower(hoarding.status);
    const head = await tx.bookingToken.findFirst({
      where: {
        hoardingId,
        status: { in: [...ACTIVE_LIKE_STATUSES] as any },
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    const hasActiveBlock = !!head;

    if (!BLOCK_CONTROLLED_STATUSES.includes(current)) {
      return { status: current, changed: false, hasActiveBlock };
    }

    let next = current || 'available';
    if (hasActiveBlock) next = 'blocked';
    else if (current === 'blocked' || current === 'tokenized') next = 'available';

    if (next !== current) {
      await tx.hoarding.update({ where: { id: hoardingId }, data: { status: next } });
      return { status: next, changed: true, hasActiveBlock };
    }
    return { status: current, changed: false, hasActiveBlock };
  }

  emitHoardingStatus(hoardingId: string, result: SyncResult) {
    try {
      eventBus.emit('hoarding-status', {
        hoardingId,
        status: result.status,
        hasActiveToken: result.hasActiveBlock,
        updatedAt: new Date().toISOString(),
        source: 'BLOCK_QUEUE',
      });
    } catch (_) {
      // never block on SSE
    }
  }

  /**
   * Closes every token still holding / waiting for this hoarding (used when the hoarding gets booked).
   * Returns the closed tokens so callers can notify the sales users.
   */
  async closeHoldingTokens(
    tx: Tx,
    hoardingId: string,
    opts: { exceptTokenId?: string; actorId?: string | null; reason: string; now?: Date },
  ): Promise<Array<{ id: string; salesUserId: string; wasActive: boolean }>> {
    const rows = await tx.bookingToken.findMany({
      where: {
        hoardingId,
        status: { in: [...HOLDING_STATUSES] as any },
        ...(opts.exceptTokenId ? { id: { not: opts.exceptTokenId } } : {}),
      },
      select: { id: true, salesUserId: true, status: true },
    });
    if (rows.length === 0) return [];
    await tx.bookingToken.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        status: 'RELEASED',
        releasedAt: opts.now || new Date(),
        releasedById: opts.actorId || null,
        releaseReason: opts.reason,
        extensionRequestedAt: null,
        extensionRequestedUntil: null,
      } as any,
    });
    return rows.map((r) => ({
      id: r.id,
      salesUserId: r.salesUserId,
      wasActive: isActiveStatus(r.status),
    }));
  }

  /**
   * Full housekeeping for one hoarding in one transaction: lock -> (close stale tokens if the
   * hoarding is already booked/live/...) -> expire + promote -> derive hoarding status.
   * Used by the background job; also safe to call from request handlers.
   */
  async processHoarding(hoardingId: string): Promise<
    NormalizeResult & { sync: SyncResult; closed: Array<{ id: string; salesUserId: string }> }
  > {
    const result = await this.withHoardingLock(hoardingId, async (tx) => {
      const now = new Date();
      let closed: Array<{ id: string; salesUserId: string }> = [];
      const h = await tx.hoarding.findUnique({ where: { id: hoardingId }, select: { status: true } });
      if (h && OPERATIONAL_HOARDING_STATUSES.includes(lower(h.status))) {
        closed = await this.closeHoldingTokens(tx, hoardingId, {
          reason: 'hoarding_unavailable',
          now,
        });
      }
      const normalized = await this.normalizeQueue(tx, hoardingId, now);
      const sync = await this.syncHoardingStatus(tx, hoardingId, now);
      return { ...normalized, sync, closed };
    });
    if (result.sync.changed) this.emitHoardingStatus(hoardingId, result.sync);
    return result;
  }

  /** Hoardings whose block expired, or that have a queue but nobody holding the block. */
  async findHoardingsNeedingAttention(now: Date = new Date()): Promise<string[]> {
    const rows = (await prisma.$queryRaw`
      SELECT DISTINCT t."hoardingId" AS id
      FROM "BookingToken" t
      WHERE (t."status" IN ('BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE') AND t."expiresAt" <= ${now})
         OR (t."status" = 'PENDING' AND NOT EXISTS (
              SELECT 1 FROM "BookingToken" a
              WHERE a."hoardingId" = t."hoardingId"
                AND a."status" IN ('BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE')
            ))
         OR (t."status" IN ('PENDING', 'BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE') AND EXISTS (
              SELECT 1 FROM "Hoarding" h
              WHERE h."id" = t."hoardingId"
                AND lower(h."status") IN ('booked', 'live', 'under_process', 'occupied', 'removal_pending')
            ))
    `) as Array<{ id: string }>;
    return rows.map((r) => String(r.id));
  }

  /** Hoardings whose stored status disagrees with their tokens (stale 'blocked', or an unflagged block). */
  async findHoardingsWithStaleStatus(now: Date = new Date()): Promise<string[]> {
    const rows = (await prisma.$queryRaw`
      SELECT h."id" AS id
      FROM "Hoarding" h
      WHERE (lower(h."status") IN ('blocked', 'tokenized') AND NOT EXISTS (
              SELECT 1 FROM "BookingToken" a
              WHERE a."hoardingId" = h."id"
                AND a."status" IN ('BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE')
                AND a."expiresAt" > ${now}
            ))
         OR (lower(h."status") = 'available' AND EXISTS (
              SELECT 1 FROM "BookingToken" a
              WHERE a."hoardingId" = h."id"
                AND a."status" IN ('BLOCKED', 'EXTENSION_REQUESTED', 'ACTIVE')
                AND a."expiresAt" > ${now}
            ))
    `) as Array<{ id: string }>;
    return rows.map((r) => String(r.id));
  }

  /** Repairs stale hoarding statuses. Returns how many hoardings were corrected. */
  async reconcileHoardingStatuses(): Promise<number> {
    if (!(await supportsPhase3BlockingSchema())) return 0;
    const ids = await this.findHoardingsWithStaleStatus();
    let fixed = 0;
    for (const id of ids) {
      try {
        const sync = await this.withHoardingLock(id, (tx) => this.syncHoardingStatus(tx, id));
        if (sync.changed) {
          fixed += 1;
          this.emitHoardingStatus(id, sync);
        }
      } catch (_) {
        // continue with the others
      }
    }
    return fixed;
  }

  /**
   * Active block (+ waiting queue) for each hoarding id. Hoardings without a valid active block
   * are simply absent from the map.
   */
  async getBlockInfoMap(hoardingIds: string[]): Promise<Map<string, HoardingBlockInfo>> {
    const out = new Map<string, HoardingBlockInfo>();
    const ids = Array.from(new Set((hoardingIds || []).map((x) => String(x || '')).filter(Boolean)));
    if (ids.length === 0) return out;
    if (!(await supportsPhase3BlockingSchema())) return out;

    const now = new Date();
    type InfoRow = {
      id: string;
      hoardingId: string;
      status: string;
      proposalId: string | null;
      salesUserId: string;
      clientId: string;
      blockedAt: Date | null;
      expiresAt: Date;
      createdAt: Date;
      client: { id: string; name: string; companyName: string | null } | null;
      salesUser: { id: string; name: string } | null;
    };
    const rows = (await prisma.bookingToken.findMany({
      where: {
        hoardingId: { in: ids },
        OR: [
          { status: { in: [...ACTIVE_LIKE_STATUSES] as any }, expiresAt: { gt: now } },
          { status: 'PENDING' },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        hoardingId: true,
        status: true,
        proposalId: true,
        salesUserId: true,
        clientId: true,
        blockedAt: true,
        expiresAt: true,
        createdAt: true,
        client: { select: { id: true, name: true, companyName: true } },
        salesUser: { select: { id: true, name: true } },
      },
    })) as unknown as InfoRow[];

    const byHoarding = new Map<string, InfoRow[]>();
    for (const row of rows) {
      const key = String(row.hoardingId);
      if (!byHoarding.has(key)) byHoarding.set(key, []);
      byHoarding.get(key)!.push(row);
    }

    for (const [hoardingId, list] of byHoarding) {
      const active = list.find((r) => isActiveStatus(r.status));
      if (!active) continue;
      const waiting = list.filter((r) => !isActiveStatus(r.status));
      const queue: QueueEntryInfo[] = waiting.map((w, idx) => ({
        tokenId: w.id,
        position: idx + 1,
        clientId: w.clientId,
        clientName: String(w.client?.name || 'Client'),
        companyName: w.client?.companyName || null,
        proposalId: w.proposalId || null,
        proposalRef: formatProposalRef(w.proposalId),
        salesUserId: w.salesUserId,
        salesUserName: String(w.salesUser?.name || 'Sales User'),
        addedAt: w.createdAt,
      }));
      out.set(hoardingId, {
        hoardingId,
        tokenId: active.id,
        status: upper(active.status) === 'EXTENSION_REQUESTED' ? 'EXTENSION_REQUESTED' : 'BLOCKED',
        clientId: active.clientId,
        clientName: String(active.client?.name || 'Client'),
        companyName: active.client?.companyName || null,
        proposalId: active.proposalId || null,
        proposalRef: formatProposalRef(active.proposalId),
        salesUserId: active.salesUserId,
        salesUserName: String(active.salesUser?.name || 'Sales User'),
        blockedAt: active.blockedAt || active.createdAt,
        expiresAt: active.expiresAt,
        queueCount: queue.length,
        queue,
      });
    }
    return out;
  }

  async getBlockInfo(hoardingId: string): Promise<HoardingBlockInfo | null> {
    const map = await this.getBlockInfoMap([hoardingId]);
    return map.get(hoardingId) || null;
  }
}

export const blockQueueService = new BlockQueueService();
