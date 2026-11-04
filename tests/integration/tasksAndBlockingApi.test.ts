/**
 * HTTP-level tests (supertest) for:
 *   - Task module: location link + photo attachments
 *   - Blocking/queue endpoints used by the Proposal Builder, finalize page and Blocked tab
 * Local test DB only.
 */
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';
import { Security } from '../../src/lib/security';
import { BlockHoardingService } from '../../src/services/bookingToken.service';
import { resetDbCapabilitiesCache } from '../../src/lib/dbCapabilities';

function assertTestDatabase() {
  const url = process.env.DATABASE_URL || '';
  if (process.env.NODE_ENV !== 'test' || !(url.includes('localhost:5433') && url.includes('hoarding_test'))) {
    throw new Error(`Refusing to run: DATABASE_URL does not look like the local test DB (${url})`);
  }
  // photo uploads must stay on local disk - never the real Firebase bucket from .env
  if (String(process.env.MEDIA_STORAGE_PROVIDER || '').toLowerCase() !== 'local') {
    throw new Error('Refusing to run: MEDIA_STORAGE_PROVIDER must be "local" in tests');
  }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const tasksDir = path.resolve(process.cwd(), 'uploads', 'tasks');
const filesOnDisk = () => (fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir) : []);

let seq = 0;
async function mkUser(name: string, roleName: string) {
  const role = await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName } });
  const user = await prisma.user.create({
    data: { name, email: `${name.replace(/\s/g, '')}${(seq += 1)}@t.local`, password: 'x', roleId: role.id, isActive: true },
    include: { role: true },
  });
  const sessionId = uuidv4();
  await prisma.refreshSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      deviceId: `dev-${sessionId}`,
      refreshTokenHash: sessionId,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await (redis as any).set(`session:${sessionId}`, user.id, 'EX', 3600);
  const token = Security.generateAccessToken({ userId: user.id, role: roleName, sessionId });
  return { user, auth: `Bearer ${token}` };
}

beforeAll(async () => {
  assertTestDatabase();
  resetDbCapabilitiesCache();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "TodoItem","BookingToken","Booking","ProposalHoarding","RateApprovalRequest","Proposal","Notification","AuditLog","RefreshSession","Client","Hoarding","User","Role" RESTART IDENTITY CASCADE`,
  );
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Tasks: location link + photo attachments', () => {
  let creator: any, other: any;
  beforeAll(async () => {
    creator = await mkUser('Task Owner', 'sales');
    other = await mkUser('Other Sales', 'sales');
  });

  it('creates a task with no link and no photos (both optional; old behaviour unchanged)', async () => {
    const res = await request(app).post('/api/todos').set('Authorization', creator.auth).send({ title: 'Plain task' });
    expect(res.status).toBe(201);
    expect(res.body.data.locationLink).toBeNull();
    expect(res.body.data.attachments).toBeNull();
  });

  it('create with location link + 2 photos; link is normalized, photos stored and viewable', async () => {
    const res = await request(app)
      .post('/api/todos')
      .set('Authorization', creator.auth)
      .field('title', 'Mount flex at CG Road')
      .field('tags', 'Urgent, Site Visit')
      .field('locationLink', 'maps.google.com/?q=23.58,72.37')
      .attach('images', PNG, { filename: 'before.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'after.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.locationLink).toBe('https://maps.google.com/?q=23.58,72.37');
    expect(res.body.data.attachments).toHaveLength(2);
    const [a1] = res.body.data.attachments;
    expect(a1.id).toBeTruthy();
    expect(a1.url).toMatch(/^\/uploads\/tasks\//);
    // the image can actually be opened
    const img = await request(app).get(a1.url);
    expect(img.status).toBe(200);
    expect(String(img.headers['content-type'])).toMatch(/image\/png/);

    // appears in the list (Task Details reads it from here)
    const list = await request(app).get('/api/todos').set('Authorization', creator.auth);
    const row = list.body.data.find((t: any) => t.id === res.body.data.id);
    expect(row.attachments).toHaveLength(2);
    expect(row.locationLink).toBe('https://maps.google.com/?q=23.58,72.37');
    (global as any).__taskId = res.body.data.id;
  });

  it('editing other details KEEPS the photos (item 23)', async () => {
    const id = (global as any).__taskId;
    const res = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', creator.auth)
      .send({ title: 'Mount flex at CG Road (edited)', description: 'new text', tags: 'Printing' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toMatch(/edited/);
    expect(res.body.data.attachments).toHaveLength(2);
    expect(res.body.data.locationLink).toBe('https://maps.google.com/?q=23.58,72.37');
  });

  it('editing can ADD more photos', async () => {
    const id = (global as any).__taskId;
    const res = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', creator.auth)
      .attach('images', PNG, { filename: 'extra.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(3);
  });

  it('a photo is removed ONLY by an explicit action, and its file is deleted', async () => {
    const id = (global as any).__taskId;
    const before = await request(app).get('/api/todos').set('Authorization', creator.auth);
    const task = before.body.data.find((t: any) => t.id === id);
    const victim = task.attachments[0];
    const res = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', creator.auth)
      .send({ removeAttachmentIds: [victim.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(2);
    expect(res.body.data.attachments.some((a: any) => a.id === victim.id)).toBe(false);
    expect(filesOnDisk()).not.toContain(path.basename(victim.url));
  });

  it('the link can be cleared; it is not compulsory', async () => {
    const id = (global as any).__taskId;
    const res = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', creator.auth)
      .send({ locationLink: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.locationLink).toBeNull();
    expect(res.body.data.attachments).toHaveLength(2);
  });

  it('rejects invalid links, wrong file types, oversize and too many files - with clean 400s and no stray files', async () => {
    const filesBefore = filesOnDisk().length;

    const badLink = await request(app)
      .post('/api/todos')
      .set('Authorization', creator.auth)
      .field('title', 'bad link')
      .field('locationLink', 'javascript:alert(1)')
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(badLink.status).toBe(400);

    const badType = await request(app)
      .post('/api/todos')
      .set('Authorization', creator.auth)
      .field('title', 'bad type')
      .attach('images', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(badType.status).toBe(400);
    expect(badType.body.message).toMatch(/JPG, PNG, WEBP or GIF/);

    const huge = await request(app)
      .post('/api/todos')
      .set('Authorization', creator.auth)
      .field('title', 'too big')
      .attach('images', Buffer.alloc(9 * 1024 * 1024, 1), { filename: 'big.png', contentType: 'image/png' });
    expect(huge.status).toBe(400);
    expect(huge.body.message).toMatch(/smaller than/);

    let many = request(app).post('/api/todos').set('Authorization', creator.auth).field('title', 'too many');
    for (let i = 0; i < 11; i += 1) many = many.attach('images', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    const manyRes = await many;
    expect(manyRes.status).toBe(400);

    const noTitle = await request(app)
      .post('/api/todos')
      .set('Authorization', creator.auth)
      .field('title', '   ')
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(noTitle.status).toBe(400);

    expect(filesOnDisk().length).toBe(filesBefore); // rejected requests leave nothing behind
  });

  it('someone who can only tick a public task cannot change its photos, but can still change status', async () => {
    const created = await request(app)
      .post('/api/todos')
      .set('Authorization', creator.auth)
      .field('title', 'Public task')
      .field('visibility', 'public')
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const before = filesOnDisk().length;

    const forbidden = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', other.auth)
      .attach('images', PNG, { filename: 'sneaky.png', contentType: 'image/png' });
    expect(forbidden.status).toBe(403);
    expect(filesOnDisk().length).toBe(before);

    const status = await request(app).patch(`/api/todos/${id}`).set('Authorization', other.auth).send({ status: 'done' });
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('done');
    expect(status.body.data.attachments).toHaveLength(1);
  });

  it('deleting a task removes its photo files', async () => {
    const id = (global as any).__taskId;
    const list = await request(app).get('/api/todos').set('Authorization', creator.auth);
    const task = list.body.data.find((t: any) => t.id === id);
    const names = task.attachments.map((a: any) => path.basename(a.url));
    const del = await request(app).delete(`/api/todos/${id}`).set('Authorization', creator.auth);
    expect(del.status).toBe(200);
    for (const n of names) expect(filesOnDisk()).not.toContain(n);
  });

  afterAll(async () => {
    // remove any task photos these tests created
    const rows = await prisma.todoItem.findMany();
    for (const r of rows) {
      for (const a of (r.attachments as any[]) || []) {
        const f = path.join(tasksDir, path.basename(String(a.url)));
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    }
  });
});

describe('Blocking API (what the UI calls)', () => {
  const blocks = new BlockHoardingService();
  let s1: any, s2: any, owner: any, h: any, proposalA: any, proposalB: any;

  async function mkProposal(sales: any, name: string, phone: string) {
    const client = await prisma.client.create({ data: { name, phone, companyName: `${name} Pvt` } });
    const p = await prisma.proposal.create({
      data: { clientId: client.id, salesUserId: sales.user.id, proposalDate: new Date(), status: 'DRAFT' },
    });
    await prisma.proposalHoarding.create({
      data: { proposalId: p.id, hoardingId: h.id, hoardingCode: h.code, finalRate: 1000, orderIndex: 0 },
    });
    return p;
  }

  beforeAll(async () => {
    s1 = await mkUser('Sales One', 'sales');
    s2 = await mkUser('Sales Two', 'sales');
    owner = await mkUser('The Owner', 'owner');
    h = await prisma.hoarding.create({
      data: { code: 'SA - 222', status: 'available', city: 'Mehsana', widthCm: 1200, heightCm: 300, minimumRate: 0 },
    });
    proposalA = await mkProposal(s1, 'Client A', '8000000001');
    proposalB = await mkProposal(s2, 'Client B', '8000000002');
  });

  it('finalize A -> blocked; finalize B on the same hoarding -> queued (HTTP)', async () => {
    const a = await request(app).post(`/api/proposals/${proposalA.id}/finalize`).set('Authorization', s1.auth).send({});
    expect(a.status).toBe(200);
    expect(a.body.data.blockResults[h.id].outcome).toBe('BLOCKED');

    const b = await request(app).post(`/api/proposals/${proposalB.id}/finalize`).set('Authorization', s2.auth).send({});
    expect(b.status).toBe(200);
    expect(b.body.data.blockResults[h.id].outcome).toBe('QUEUED');
    expect(b.body.data.blockResults[h.id].waitingPosition).toBe(1);
  });

  it('Proposal Builder list shows blocked info + queue count; Blocked tab shows the same single block', async () => {
    const list = await request(app).get('/api/hoardings?limit=50').set('Authorization', s2.auth);
    expect(list.status).toBe(200);
    const row = list.body.data.hoardings.find((x: any) => x.id === h.id);
    expect(row.status).toBe('blocked');
    expect(row.blockInfo.clientName).toBe('Client A');
    expect(row.blockInfo.salesUserName).toBe('Sales One');
    expect(row.blockInfo.queueCount).toBe(1);

    const tab = await request(app).get('/api/blocked-hoardings/by-client').set('Authorization', owner.auth);
    expect(tab.status).toBe(200);
    expect(tab.body.data).toHaveLength(1);
    expect(tab.body.data[0].clientName).toBe('Client A');
    expect(tab.body.data[0].hoardings[0].queueCount).toBe(1);
  });

  it('queue details endpoint returns position, client, company, proposal ref, sales user and time added', async () => {
    const res = await request(app).get(`/api/blocked-hoardings/${h.id}/queue`).set('Authorization', s1.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.active.clientName).toBe('Client A');
    expect(res.body.data.active.salesUserName).toBe('Sales One');
    expect(res.body.data.queue).toHaveLength(1);
    const q = res.body.data.queue[0];
    expect(q.position).toBe(1);
    expect(q.clientName).toBe('Client B');
    expect(q.companyName).toBe('Client B Pvt');
    expect(q.salesUserName).toBe('Sales Two');
    expect(q.proposalRef).toMatch(/^PR-/);
    expect(q.addedAt).toBeTruthy();
  });

  it('proposal detail exposes this proposal\'s own queue state for the finalize page', async () => {
    const res = await request(app).get(`/api/proposals/${proposalB.id}`).set('Authorization', s2.auth);
    expect(res.status).toBe(200);
    const line = res.body.data.hoardings[0];
    expect(line.blockState.outcome).toBe('QUEUED');
    expect(line.blockState.waitingPosition).toBe(1);
    expect(line.blockInfo.clientName).toBe('Client A');
  });

  it('release endpoint (Leave queue / Unblock) works over HTTP and promotes the next client', async () => {
    const forbidden = await request(app)
      .post(`/api/proposals/${proposalB.id}/hoardings/${h.id}/release`)
      .set('Authorization', s1.auth);
    expect(forbidden.status).toBe(403);

    const rel = await request(app)
      .post(`/api/proposals/${proposalA.id}/hoardings/${h.id}/release`)
      .set('Authorization', s1.auth);
    expect(rel.status).toBe(200);

    const tab = await request(app).get('/api/blocked-hoardings/by-client').set('Authorization', owner.auth);
    expect(tab.body.data).toHaveLength(1);
    expect(tab.body.data[0].clientName).toBe('Client B');
    expect(tab.body.data[0].hoardings[0].queueCount).toBe(0);
  });

  it('expiry via the job promotes nothing when queue is empty and the hoarding turns available everywhere', async () => {
    const t = await prisma.bookingToken.findFirst({ where: { hoardingId: h.id, status: 'BLOCKED' } });
    await prisma.bookingToken.update({ where: { id: t.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await blocks.expireAndPromote();

    const list = await request(app).get('/api/hoardings?limit=50').set('Authorization', s1.auth);
    const row = list.body.data.hoardings.find((x: any) => x.id === h.id);
    expect(row.status).toBe('available');
    expect(row.blockInfo).toBeNull();
    const tab = await request(app).get('/api/blocked-hoardings/by-client').set('Authorization', owner.auth);
    expect(tab.body.data).toHaveLength(0);
  });
});
