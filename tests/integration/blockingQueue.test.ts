/**
 * Blocking + queue lifecycle ("BLOCKING LOGIC FIXES" spec).
 * Runs against the LOCAL test database only (see assertTestDatabase).
 *
 *   ONE HOARDING = MAXIMUM ONE ACTIVE BLOCK, everyone else waits in a FIFO queue.
 */
import { prisma } from '../../src/lib/prisma';
import { BlockHoardingService } from '../../src/services/bookingToken.service';
import { ProposalsService } from '../../src/services/proposals.service';
import { blockQueueService } from '../../src/services/blockQueue.service';
import blockedHoardingsService from '../../src/services/blockedHoardings.service';
import { HoardingService } from '../../src/services/hoarding.service';
import { resetDbCapabilitiesCache } from '../../src/lib/dbCapabilities';

function assertTestDatabase() {
  const url = process.env.DATABASE_URL || '';
  if (process.env.NODE_ENV !== 'test' || !(url.includes('localhost:5433') && url.includes('hoarding_test'))) {
    throw new Error(`Refusing to run: DATABASE_URL does not look like the local test DB (${url})`);
  }
}

const HOURS = 60 * 60 * 1000;
const blocks = new BlockHoardingService();
const proposals = new ProposalsService();
const hoardingSvc = new HoardingService();

let seq = 0;
const next = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function reset() {
  assertTestDatabase();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "BookingToken","Booking","ProposalHoarding","RateApprovalRequest","Proposal","Notification","AuditLog","BillingEvent","Client","Hoarding","User","Role" RESTART IDENTITY CASCADE`,
  );
}

async function mkRole(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name } });
}
async function mkUser(name: string, roleName: string) {
  const role = await mkRole(roleName);
  return prisma.user.create({
    data: { name, email: `${next()}@t.local`, password: 'x', roleId: role.id, isActive: true },
    include: { role: true },
  });
}
let phoneSeq = 9000000000;
const mkClientInput = (name: string, companyName?: string) => ({
  name,
  phone: String((phoneSeq += 1)),
  companyName,
});
async function mkHoarding(code: string, status = 'available') {
  return prisma.hoarding.create({
    data: { code, status, city: 'Mehsana', widthCm: 1200, heightCm: 300, minimumRate: 0, standardRate: 1000 },
  });
}
const range = () => {
  const from = new Date();
  const to = new Date(Date.now() + 8 * 24 * HOURS);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
};

async function block(h: { id: string }, sales: { id: string }, client: ReturnType<typeof mkClientInput>, proposalId?: string) {
  return blocks.createBlock({
    hoardingId: h.id,
    ...range(),
    client,
    salesUserId: sales.id,
    actorRoleName: 'sales',
    proposalId: proposalId || null,
  });
}
const activeCount = async (hoardingId: string) =>
  prisma.bookingToken.count({
    where: { hoardingId, status: { in: ['BLOCKED', 'EXTENSION_REQUESTED'] } },
  });
const statusOf = async (hoardingId: string) =>
  String((await prisma.hoarding.findUnique({ where: { id: hoardingId } })).status);
const tok = (id: string) => prisma.bookingToken.findUnique({ where: { id } });
const expireNow = (id: string) =>
  prisma.bookingToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

beforeAll(async () => {
  assertTestDatabase();
  resetDbCapabilitiesCache();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('capability detection', () => {
  it('detects the phase-3 schema on the migrated test DB (no longer hard-coded off)', async () => {
    const { supportsPhase3BlockingSchema } = await import('../../src/lib/dbCapabilities');
    expect(await supportsPhase3BlockingSchema()).toBe(true);
  });
});

describe('one active block + FIFO queue', () => {
  let s1: any, s2: any, s3: any, owner: any, h: any;
  beforeEach(async () => {
    await reset();
    s1 = await mkUser('Sales 1', 'sales');
    s2 = await mkUser('Sales 2', 'sales');
    s3 = await mkUser('Sales 3', 'sales');
    owner = await mkUser('Owner', 'owner');
    h = await mkHoarding('SA - 222');
  });

  it('first client gets the ACTIVE block for 48 hours; hoarding becomes blocked', async () => {
    const r = await block(h, s1, mkClientInput('Client A'));
    expect(r.outcome).toBe('BLOCKED');
    expect(r.queuePosition).toBe(1);
    const t = await tok(r.blockId);
    expect(t.status).toBe('BLOCKED');
    expect(t.blockedAt).not.toBeNull();
    const hours = (new Date(t.expiresAt).getTime() - new Date(t.blockedAt).getTime()) / HOURS;
    expect(hours).toBeCloseTo(48, 1);
    expect(await statusOf(h.id)).toBe('blocked');
  });

  it('a second client (different sales user) must ENTER THE QUEUE, not become another block', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    expect(b.outcome).toBe('QUEUED');
    expect(b.waitingPosition).toBe(1);
    expect((await tok(a.blockId)).status).toBe('BLOCKED');
    expect((await tok(b.blockId)).status).toBe('PENDING');
    expect(await activeCount(h.id)).toBe(1);
  });

  it('the SAME sales user with another client must also follow the queue (item 13)', async () => {
    await block(h, s1, mkClientInput('Client A'));
    const c = await block(h, s1, mkClientInput('Client C'));
    expect(c.outcome).toBe('QUEUED');
    expect(c.waitingPosition).toBe(1);
    expect(await activeCount(h.id)).toBe(1);
  });

  it('queue positions are FIFO and gap free (PDF example: A active, B=1, C=2, D=3)', async () => {
    await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    const c = await block(h, s1, mkClientInput('Client C'));
    const d = await block(h, s3, mkClientInput('Client D'));
    expect([b.waitingPosition, c.waitingPosition, d.waitingPosition]).toEqual([1, 2, 3]);
    const info = await blockQueueService.getBlockInfo(h.id);
    expect(info!.clientName).toBe('Client A');
    expect(info!.salesUserName).toBe('Sales 1');
    expect(info!.queueCount).toBe(3);
    expect(info!.queue.map((q) => [q.position, q.clientName, q.salesUserName])).toEqual([
      [1, 'Client B', 'Sales 2'],
      [2, 'Client C', 'Sales 1'],
      [3, 'Client D', 'Sales 3'],
    ]);
  });

  it('the same client cannot hold or queue the same hoarding twice', async () => {
    const client = mkClientInput('Client A');
    await block(h, s1, client);
    await expect(block(h, s2, client)).rejects.toThrow(/already/i);
    expect(await activeCount(h.id)).toBe(1);
  });

  it('refuses a booked hoarding', async () => {
    const booked = await mkHoarding('SA - 900', 'booked');
    await expect(block(booked, s1, mkClientInput('X'))).rejects.toThrow(/booked/i);
  });

  it('CONCURRENCY: 6 clients racing for the same hoarding -> exactly 1 active, 5 queued with distinct positions', async () => {
    const sellers = [s1, s2, s3, s1, s2, s3];
    const results = await Promise.all(
      sellers.map((s, i) => block(h, s, mkClientInput(`Racer ${i}`))),
    );
    expect(results.filter((r) => r.outcome === 'BLOCKED')).toHaveLength(1);
    expect(await activeCount(h.id)).toBe(1);
    const positions = results.map((r) => r.queuePosition).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await statusOf(h.id)).toBe('blocked');
  });

  it('the DATABASE itself rejects a second active block', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    await expect(
      prisma.bookingToken.update({ where: { id: b.blockId }, data: { status: 'BLOCKED' } }),
    ).rejects.toThrow();
    expect((await tok(a.blockId)).status).toBe('BLOCKED');
  });
});

describe('expiry, automatic promotion, fresh 48 hours', () => {
  let s1: any, s2: any, s3: any, h: any;
  beforeEach(async () => {
    await reset();
    s1 = await mkUser('Sales 1', 'sales');
    s2 = await mkUser('Sales 2', 'sales');
    s3 = await mkUser('Sales 3', 'sales');
    h = await mkHoarding('SA - 222');
  });

  it('PDF §19: A expires -> B auto-promoted with a FRESH 48h, C moves to queue position 1; then B -> C; then free', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    const c = await block(h, s1, mkClientInput('Client C'));

    await expireNow(a.blockId);
    const before = Date.now();
    await blocks.expireAndPromote();

    expect((await tok(a.blockId)).status).toBe('EXPIRED');
    const tb = await tok(b.blockId);
    expect(tb.status).toBe('BLOCKED');
    expect(tb.queuePosition).toBe(1);
    // fresh 48h counted from the promotion moment, NOT from when B joined the queue
    const freshHours = (new Date(tb.expiresAt).getTime() - before) / HOURS;
    expect(freshHours).toBeGreaterThan(47.9);
    expect(freshHours).toBeLessThan(48.1);
    const tc = await tok(c.blockId);
    expect(tc.status).toBe('PENDING');
    expect(tc.queuePosition).toBe(2); // = waiting position 1
    expect(await activeCount(h.id)).toBe(1);
    expect(await statusOf(h.id)).toBe('blocked');

    await expireNow(b.blockId);
    await blocks.expireAndPromote();
    expect((await tok(b.blockId)).status).toBe('EXPIRED');
    expect((await tok(c.blockId)).status).toBe('BLOCKED');

    await expireNow(c.blockId);
    await blocks.expireAndPromote();
    expect((await tok(c.blockId)).status).toBe('EXPIRED');
    expect(await activeCount(h.id)).toBe(0);
    expect(await statusOf(h.id)).toBe('available'); // block expired -> no longer blocked anywhere
  });

  it('promotion notifies the promoted sales user', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    await expireNow(a.blockId);
    await blocks.expireAndPromote();
    const n = await prisma.notification.findMany({ where: { userId: s2.id } });
    expect(n.some((x: any) => /promoted/i.test(x.title))).toBe(true);
    expect((await tok(b.blockId)).status).toBe('BLOCKED');
  });

  it('releasing the active block promotes the next client with a fresh 48h; releasing a queued entry compacts positions', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    const c = await block(h, s3, mkClientInput('Client C'));
    const d = await block(h, s2, mkClientInput('Client D'));

    await blocks.cancelToken(c.blockId, s3.id, 'sales'); // middle of the queue leaves
    expect((await tok(b.blockId)).queuePosition).toBe(2);
    expect((await tok(d.blockId)).queuePosition).toBe(3);

    await blocks.cancelToken(a.blockId, s1.id, 'sales'); // active releases
    expect((await tok(a.blockId)).status).toBe('RELEASED');
    expect((await tok(b.blockId)).status).toBe('BLOCKED');
    expect((await tok(d.blockId)).queuePosition).toBe(2);
    expect(await activeCount(h.id)).toBe(1);
  });
});

describe('booking closes the whole queue', () => {
  let s1: any, s2: any, s3: any, mgr: any, h: any;
  beforeEach(async () => {
    await reset();
    s1 = await mkUser('Sales 1', 'sales');
    s2 = await mkUser('Sales 2', 'sales');
    s3 = await mkUser('Sales 3', 'sales');
    mgr = await mkUser('Manager', 'manager');
    h = await mkHoarding('SA - 222');
  });

  it('when the active client books, hoarding is booked and B, C, D are closed - no later promotion', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    const c = await block(h, s3, mkClientInput('Client C'));

    await blocks.confirmToken(
      a.blockId,
      s1.id,
      'sales',
      'CLIENT_DIRECT_FLEX',
      new Date(Date.now() + 5 * 24 * HOURS).toISOString().slice(0, 10),
      3,
      {
        paymentPlanType: 'ADVANCE_MONTHLY',
        billingFrequency: 'MONTHLY',
        gstApplicable: true,
        finalAgreedBasePrice: 50000,
        modeOfPayment: 'BANK_TRANSFER',
      },
    );

    expect(await statusOf(h.id)).toBe('booked');
    expect((await tok(a.blockId)).status).toBe('APPROVED');
    for (const x of [b, c]) {
      const t = await tok(x.blockId);
      expect(t.status).toBe('RELEASED');
      expect(t.releaseReason).toBe('booked');
    }
    await blocks.expireAndPromote();
    expect(await activeCount(h.id)).toBe(0);
    expect(await statusOf(h.id)).toBe('booked');
    await expect(block(h, s2, mkClientInput('Late client'))).rejects.toThrow(/booked/i);
  });

  it('a queued (non-active) client cannot book', async () => {
    await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));
    await expect(blocks.confirmToken(b.blockId, mgr.id, 'manager')).rejects.toThrow();
  });
});

describe('single source of truth for status', () => {
  let s1: any, s2: any, h: any;
  beforeEach(async () => {
    await reset();
    s1 = await mkUser('Sales 1', 'sales');
    s2 = await mkUser('Sales 2', 'sales');
    h = await mkHoarding('SA - 222');
  });

  it('stale "blocked" hoardings with no real block are repaired; real blocks are kept; booked untouched', async () => {
    const stale1 = await mkHoarding('SA - 301', 'blocked');
    const stale2 = await mkHoarding('SA - 302', 'tokenized');
    const booked = await mkHoarding('SA - 303', 'booked');
    const a = await block(h, s1, mkClientInput('Client A')); // real block on h

    const fixed = await blockQueueService.reconcileHoardingStatuses();
    expect(fixed).toBe(2);
    expect(await statusOf(stale1.id)).toBe('available');
    expect(await statusOf(stale2.id)).toBe('available');
    expect(await statusOf(booked.id)).toBe('booked');
    expect(await statusOf(h.id)).toBe('blocked');
    expect((await tok(a.blockId)).status).toBe('BLOCKED');
  });

  it('inventory list shows the SAME state as the Blocked tab (and a stale flag is not shown as blocked)', async () => {
    const stale = await mkHoarding('SA - 301', 'blocked');
    const a = await block(h, s1, mkClientInput('Client A', 'ABC Industries'));
    await block(h, s2, mkClientInput('Client B'));

    const list = await hoardingSvc.getAll({ limit: '50' } as any, {
      id: s1.id,
      role: { name: 'owner' },
    } as any);
    const row = (list.hoardings as any[]).find((x) => x.id === h.id);
    const staleRow = (list.hoardings as any[]).find((x) => x.id === stale.id);
    expect(row.status).toBe('blocked');
    expect(row.blockInfo.clientName).toBe('Client A');
    expect(row.blockInfo.salesUserName).toBe('Sales 1');
    expect(row.blockInfo.queueCount).toBe(1);
    expect(staleRow.status).toBe('available');

    const tab = await blockedHoardingsService.listByClient();
    const items = tab.flatMap((g) => g.hoardings);
    expect(items.map((i) => i.code)).toEqual(['SA - 222']); // stale one is NOT there, and not shown blocked either
    expect(items[0].companyName).toBe('ABC Industries');
    expect(items[0].salesUserName).toBe('Sales 1');
    expect(items[0].queueCount).toBe(1);
    expect(items[0].queue[0].clientName).toBe('Client B');
    expect(items[0].blockExpiry).toBeTruthy();

    const detail = await hoardingSvc.getById(h.id);
    expect(detail.status).toBe('blocked');
    expect(detail.blockInfo.queueCount).toBe(1);
    expect(a.outcome).toBe('BLOCKED');
  });

  it('manual "Unblock" releases the real token(s) instead of just flipping the flag', async () => {
    const a = await block(h, s1, mkClientInput('Client A'));
    const b = await block(h, s2, mkClientInput('Client B'));

    // sales 2 cannot release sales 1's block
    await expect(
      hoardingSvc.finalizeWorkflowStatus(h.id, 'AVAILABLE', { id: s2.id, roleName: 'sales' } as any),
    ).resolves.toBeDefined(); // releases only their OWN queue entry
    expect((await tok(b.blockId)).status).toBe('RELEASED');
    expect((await tok(a.blockId)).status).toBe('BLOCKED');
    expect(await statusOf(h.id)).toBe('blocked');

    // sales 1 releases own active block -> nothing left -> available everywhere
    await hoardingSvc.finalizeWorkflowStatus(h.id, 'AVAILABLE', { id: s1.id, roleName: 'sales' } as any);
    expect((await tok(a.blockId)).status).toBe('RELEASED');
    expect(await statusOf(h.id)).toBe('available');
  });

  it('manual blocking without a token is refused (would create a stale, owner-less block)', async () => {
    await expect(
      hoardingSvc.finalizeWorkflowStatus(h.id, 'BLOCKED', { id: s1.id, roleName: 'sales' } as any),
    ).rejects.toThrow(/Manual blocking/i);
    expect(await statusOf(h.id)).toBe('available');
  });
});

describe('proposal finalize flow', () => {
  let s1: any, s2: any, h: any;
  beforeEach(async () => {
    await reset();
    s1 = await mkUser('Sales 1', 'sales');
    s2 = await mkUser('Sales 2', 'sales');
    h = await mkHoarding('SA - 222');
  });

  async function mkProposal(sales: any, clientInput: ReturnType<typeof mkClientInput>, hoardingIds: string[]) {
    const client = await prisma.client.create({ data: { ...clientInput } });
    const p = await prisma.proposal.create({
      data: { clientId: client.id, salesUserId: sales.id, proposalDate: new Date(), status: 'DRAFT' },
    });
    let i = 0;
    for (const hid of hoardingIds) {
      const hh = await prisma.hoarding.findUnique({ where: { id: hid } });
      await prisma.proposalHoarding.create({
        data: { proposalId: p.id, hoardingId: hid, hoardingCode: hh.code, finalRate: 1000, orderIndex: i++ },
      });
    }
    return p;
  }
  const finalize = (p: any, sales: any, ids?: string[]) =>
    proposals.finalizeProposal({
      proposalId: p.id,
      actorId: sales.id,
      actorRole: 'sales',
      selectedHoardingIds: ids,
    });

  it('a DRAFT proposal alone does NOT block anything (item 17)', async () => {
    await mkProposal(s1, mkClientInput('Client A'), [h.id]);
    expect(await statusOf(h.id)).toBe('available');
    expect(await blockedHoardingsService.listByClient()).toHaveLength(0);
  });

  it('SA 222 end to end: A blocks, B (other sales) queues, C (same sales as A) queues; A expires -> B active; B books -> C closed', async () => {
    const pA = await mkProposal(s1, mkClientInput('Client A'), [h.id]);
    const pB = await mkProposal(s2, mkClientInput('Client B'), [h.id]);
    const pC = await mkProposal(s1, mkClientInput('Client C'), [h.id]);

    const rA: any = await finalize(pA, s1);
    expect(rA.blockResults[h.id].outcome).toBe('BLOCKED');
    expect(rA.status).toBe('FINALIZED');

    const rB: any = await finalize(pB, s2);
    expect(rB.blockResults[h.id].outcome).toBe('QUEUED');
    expect(rB.blockResults[h.id].waitingPosition).toBe(1);
    expect(rB.status).toBe('FINALIZED');

    const rC: any = await finalize(pC, s1);
    expect(rC.blockResults[h.id].outcome).toBe('QUEUED');
    expect(rC.blockResults[h.id].waitingPosition).toBe(2);

    expect(await activeCount(h.id)).toBe(1);
    const tab = await blockedHoardingsService.listByClient();
    expect(tab).toHaveLength(1); // ONLY Client A is shown as blocked
    expect(tab[0].clientName).toBe('Client A');
    expect(tab[0].hoardings[0].proposalRef).toMatch(/^PR-/);
    expect(tab[0].hoardings[0].queueCount).toBe(2);

    // proposal view carries this proposal's own state + the shared block info
    const viewB: any = await proposals.getProposalById(pB.id);
    expect(viewB.hoardings[0].blockState.outcome).toBe('QUEUED');
    expect(viewB.hoardings[0].blockInfo.clientName).toBe('Client A');
    expect(viewB.hoardings[0].hoarding.status).toBe('blocked');

    // idempotent: finalizing again does not create a second entry
    await finalize(pB, s2);
    expect(await prisma.bookingToken.count({ where: { hoardingId: h.id, status: 'PENDING' } })).toBe(2);

    // A's 48h elapse
    const tokenA = await prisma.bookingToken.findFirst({ where: { proposalId: pA.id } });
    await expireNow(tokenA.id);
    await blocks.expireAndPromote();
    const infoAfter = await blockQueueService.getBlockInfo(h.id);
    expect(infoAfter!.clientName).toBe('Client B');
    expect(infoAfter!.queueCount).toBe(1);
    expect(infoAfter!.queue[0].clientName).toBe('Client C');

    // B books -> C's queue closes
    const tokenB = await prisma.bookingToken.findFirst({ where: { proposalId: pB.id } });
    await blocks.confirmToken(tokenB.id, (await mkUser('Mgr', 'manager')).id, 'manager');
    const tokenC = await prisma.bookingToken.findFirst({ where: { proposalId: pC.id } });
    expect((await tok(tokenC.id)).status).toBe('RELEASED');
    expect(await blockedHoardingsService.listByClient()).toHaveLength(0);
    expect(await statusOf(h.id)).toBe('under_process');
  });

  it('"Unblock" / leave-queue on a proposal releases through the queue logic and promotes the next client', async () => {
    const pA = await mkProposal(s1, mkClientInput('Client A'), [h.id]);
    const pB = await mkProposal(s2, mkClientInput('Client B'), [h.id]);
    await finalize(pA, s1);
    await finalize(pB, s2);

    await proposals.releaseProposalHoarding({
      proposalId: pA.id,
      hoardingId: h.id,
      actorId: s1.id,
      actorRole: 'sales',
    });
    const info = await blockQueueService.getBlockInfo(h.id);
    expect(info!.clientName).toBe('Client B');
    expect(await statusOf(h.id)).toBe('blocked');
    expect((await prisma.proposal.findUnique({ where: { id: pA.id } })).status).toBe('DRAFT');

    // sales 1 cannot release sales 2's proposal
    await expect(
      proposals.releaseProposalHoarding({
        proposalId: pB.id,
        hoardingId: h.id,
        actorId: s1.id,
        actorRole: 'sales',
      }),
    ).rejects.toThrow();
  });

  it('a failed finalize leaves NO tokens behind (all-or-nothing)', async () => {
    const h2 = await mkHoarding('SA - 223', 'booked');
    const pA = await mkProposal(s1, mkClientInput('Client A'), [h.id, h2.id]);
    await expect(finalize(pA, s1)).rejects.toThrow();
    expect(await prisma.bookingToken.count({ where: { proposalId: pA.id } })).toBe(0);
    expect(await statusOf(h.id)).toBe('available');
  });

  it('regenerating a proposal PDF-style housekeeping never drops a finalized block', async () => {
    const pA = await mkProposal(s1, mkClientInput('Client A'), [h.id]);
    await finalize(pA, s1);
    // processHoarding is what the job/PDF path may call: it must keep a valid block
    await blockQueueService.processHoarding(h.id);
    expect(await activeCount(h.id)).toBe(1);
    expect(await statusOf(h.id)).toBe('blocked');
  });
});
