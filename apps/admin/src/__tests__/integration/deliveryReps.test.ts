/**
 * PR-2a against real Postgres, through the real createContext: a delivery rep
 * sees only the orders assigned to them — in the code and, when a query
 * forgets, in the database (0077) — delivers and collects once however often
 * the request is retried, hands the cash over, and every step leaves the
 * ledger balanced: AR-COD is cleared on collection, custody on the count and
 * the write-off.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  accessRoles, deliveryAttempts, orders, orgMembers, organizations, repCashCollections, repCashHandovers, withOrgContext,
} from '@irth/db';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { verifySession } = await import('@/lib/auth');
const { createContext } = await import('@/server/trpc');
const { appRouter } = await import('@/server/routers/_app');

let org: string;
const ids: Record<string, string> = {};
let seq = 0;

async function member(kind: 'owner' | 'admin' | 'rep' | 'staff') {
  const userId = `rep-user-${++seq}`;
  const role = kind === 'owner' ? 'owner' : kind === 'admin' ? 'admin' : 'member';
  const [m] = await testDb.insert(orgMembers).values({ orgId: org, userId, role }).returning();
  if (kind === 'rep') {
    await testDb.update(orgMembers).set({ accessRoleId: ids.repRole, principalKind: 'delivery_rep' }).where(eq(orgMembers.id, m.id));
  }
  return { userId, memberId: m.id };
}

async function as(userId: string) {
  vi.mocked(verifySession).mockResolvedValue({ user: { id: userId, email: `${userId}@test.com` } } as never);
  return appRouter.createCaller(await createContext());
}

async function code(p: Promise<unknown>) {
  try { await p; return 'OK'; } catch (err) { return err instanceof TRPCError ? err.code : String(err); }
}

async function order(orderNumber: string, repMemberId: string | null, opts: { total?: bigint; paymentMethod?: 'cod' | 'online' } = {}) {
  const [o] = await testDb.insert(orders).values({
    orgId: org, orderNumber, status: 'shipped', paymentMethod: opts.paymentMethod ?? 'cod',
    totalAmountMinor: opts.total ?? 11400n, currency: 'EGP', assignedRepMemberId: repMemberId,
    shippingAddress: { address1: 'شارع التحرير', city: 'القاهرة' } as never,
  }).returning();
  return o.id;
}

/** Debit minus credit on one account, across every entry. */
async function balance(accountCode: string): Promise<bigint> {
  const [row] = await testDb.execute<{ b: string | null }>(sql`
    SELECT SUM(l.debit_minor - l.credit_minor)::text AS b
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.org_id = ${org} AND a.code = ${accountCode}`);
  return BigInt(row?.b ?? '0');
}

async function unbalancedEntries(): Promise<number> {
  const rows = await testDb.execute<{ entry_id: string }>(sql`
    SELECT entry_id FROM journal_lines WHERE org_id = ${org}
    GROUP BY entry_id HAVING SUM(debit_minor) <> SUM(credit_minor)`);
  return [...rows].length;
}

let owner: { userId: string; memberId: string };
let admin: { userId: string; memberId: string };
let repA: { userId: string; memberId: string };
let repB: { userId: string; memberId: string };
let staff: { userId: string; memberId: string };

beforeAll(async () => {
  await truncateAll();
  const [o] = await testDb.insert(organizations).values({ name: 'Reps', slug: `reps-${Date.now()}` }).returning();
  org = o.id;
  const [role] = await testDb.insert(accessRoles).values({
    orgId: org, name: 'مندوب توصيل', principalKind: 'delivery_rep',
    permissions: { deliveries: ['view', 'update', 'collect'], repCash: ['handover'], sensitive: ['customerContact'] },
  }).returning();
  ids.repRole = role.id;
  owner = await member('owner');
  admin = await member('admin');
  repA = await member('rep');
  repB = await member('rep');
  staff = await member('staff');
  ids.O1 = await order('R-1', repA.memberId);
  ids.O2 = await order('R-2', repB.memberId);
  ids.O3 = await order('R-3', null, { total: 5000n });
  ids.O4 = await order('R-4', repA.memberId, { paymentMethod: 'online' });
});
afterAll(async () => { await closeTestDb(); });

describe('a rep sees only their own orders', () => {
  it('in the rep screen, by id, and in the orders screen when granted it', async () => {
    const a = await as(repA.userId);
    expect((await a.deliveries.today()).data.map((r) => r.orderNumber).sort()).toEqual(['R-1', 'R-4']);
    expect(await code(a.deliveries.get({ id: ids.O2 }))).toBe('NOT_FOUND');
    const detail = (await a.deliveries.get({ id: ids.O1 })).data;
    expect(detail.order.codDueMinor).toBe(11400n);
    expect(detail.order.shippingAddress).toBeTruthy();
    // No orders.view by default…
    expect(await code(a.orders.list({}))).toBe('FORBIDDEN');
    // …and when granted it, still only their own.
    await testDb.update(orgMembers).set({ overrides: { grant: { orders: ['view'] } } }).where(eq(orgMembers.id, repA.memberId));
    const granted = await as(repA.userId);
    expect((await granted.orders.list({})).data.map((r) => r.orderNumber).sort()).toEqual(['R-1', 'R-4']);
    expect(await code(granted.orders.getById({ id: ids.O2 }))).toBe('NOT_FOUND');
    await testDb.update(orgMembers).set({ overrides: {} }).where(eq(orgMembers.id, repA.memberId));
  });

  it('the database alone holds it: a query with no rep WHERE sees one rep\'s orders, and nothing without a member id', async () => {
    const settings = { brand: [], supplier: [], principalKind: 'delivery_rep' as const };
    const seen = await withOrgContext(testDb, org, (tx) => tx.select({ n: orders.orderNumber }).from(orders), { ...settings, memberId: repA.memberId });
    expect(seen.map((r) => r.n).sort()).toEqual(['R-1', 'R-4']);
    const blind = await withOrgContext(testDb, org, (tx) => tx.select({ n: orders.orderNumber }).from(orders), { ...settings, memberId: null });
    expect(blind).toEqual([]);
    // A rep cannot hand their order to someone else.
    await expect(withOrgContext(testDb, org, (tx) => tx.update(orders).set({ assignedRepMemberId: repB.memberId }).where(eq(orders.id, ids.O1)),
      { ...settings, memberId: repA.memberId })).rejects.toBeTruthy();
    // Staff are not narrowed.
    const all = await withOrgContext(testDb, org, (tx) => tx.select({ n: orders.orderNumber }).from(orders),
      { brand: [], supplier: [], principalKind: 'staff', memberId: admin.memberId });
    expect(all.length).toBe(4);
  });
});

describe('the code alone holds it too', () => {
  it('with a transaction that carries no rep settings, the procedures still filter to the caller', async () => {
    // Same access as the real rep, but withOrg sets only the tenant: 0077's
    // policies see a non-rep, so only the code's own WHERE can narrow.
    vi.mocked(verifySession).mockResolvedValue({ user: { id: repA.userId, email: 'x@test.com' } } as never);
    const ctx = await createContext();
    const access = { ...ctx.access, perms: new Set([...ctx.access.perms, 'orders.view']) };
    const c = appRouter.createCaller({
      ...ctx, access,
      withOrg: <T,>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, org, fn),
    } as unknown as Context);
    expect((await c.deliveries.today()).data.map((r) => r.orderNumber).sort()).toEqual(['R-1', 'R-4']);
    expect(await code(c.deliveries.get({ id: ids.O2 }))).toBe('NOT_FOUND');
    expect((await c.orders.list({})).data.map((r) => r.orderNumber).sort()).toEqual(['R-1', 'R-4']);
    expect(await code(c.orders.getById({ id: ids.O2 }))).toBe('NOT_FOUND');
  });
});

describe('assigning orders', () => {
  it('an admin assigns to an active rep only; a rep cannot assign', async () => {
    const ad = await as(admin.userId);
    expect((await ad.orders.reps()).data.map((r) => r.memberId).sort()).toEqual([repA.memberId, repB.memberId].sort());
    expect(await code(ad.orders.assignRep({ orderIds: [ids.O3], memberId: staff.memberId }))).toBe('BAD_REQUEST');
    const res = await ad.orders.assignRep({ orderIds: [ids.O3], memberId: repA.memberId });
    expect(res.data.assigned).toEqual([ids.O3]);
    expect(await code((await as(repA.userId)).orders.assignRep({ orderIds: [ids.O2], memberId: repA.memberId }))).toBe('FORBIDDEN');
  });
});

describe('delivering and collecting', () => {
  it('collects exactly the order total, once, however the request is retried', async () => {
    const a = await as(repA.userId);
    expect(await code(a.deliveries.markDelivered({ orderId: ids.O1, collected: '100', idempotencyKey: 'k-bad' }))).toBe('BAD_REQUEST');
    expect(await code(a.deliveries.markDelivered({ orderId: ids.O2, collected: '114', idempotencyKey: 'k-other' }))).toBe('NOT_FOUND');

    const first = await a.deliveries.markDelivered({ orderId: ids.O1, collected: '114.00', idempotencyKey: 'k-1' });
    const replay = await a.deliveries.markDelivered({ orderId: ids.O1, collected: '114.00', idempotencyKey: 'k-1' });
    expect(replay).toEqual(first);
    expect(await code(a.deliveries.markDelivered({ orderId: ids.O1, collected: '114.00', idempotencyKey: 'k-2' }))).toBe('CONFLICT');

    const collections = await testDb.select().from(repCashCollections).where(eq(repCashCollections.orderId, ids.O1));
    expect(collections.map((c) => c.amountMinor)).toEqual([11400n]);
    // The database refuses a second collection even past the code.
    await expect(testDb.insert(repCashCollections).values({ orgId: org, memberId: repA.memberId, orderId: ids.O1, amountMinor: 1n, currency: 'EGP' }))
      .rejects.toBeTruthy();

    // Revenue booked AR-COD; the collection moved it into custody.
    expect(await balance('1030')).toBe(0n);
    expect(await balance('1060')).toBe(11400n);
    expect(await unbalancedEntries()).toBe(0);
    const [o] = await testDb.select({ status: orders.status }).from(orders).where(eq(orders.id, ids.O1));
    expect(o.status).toBe('delivered');
  });

  it('an order paid online is delivered with nothing to collect', async () => {
    const a = await as(repA.userId);
    const res = await a.deliveries.markDelivered({ orderId: ids.O4, idempotencyKey: 'k-online' });
    expect(res.data.collected).toBe(false);
    expect(await balance('1060')).toBe(11400n);
  });

  it('a failed attempt is logged and the order stays out for delivery; not on someone else\'s order', async () => {
    const b = await as(repB.userId);
    await b.deliveries.markUndelivered({ orderId: ids.O2, outcome: 'failed', reason: 'العميل مش بيرد' });
    const [o] = await testDb.select({ status: orders.status }).from(orders).where(eq(orders.id, ids.O2));
    expect(o.status).toBe('shipped');
    const attempts = await testDb.select().from(deliveryAttempts).where(and(eq(deliveryAttempts.orderId, ids.O2), eq(deliveryAttempts.outcome, 'failed')));
    expect(attempts).toHaveLength(1);
    expect(await code((await as(repA.userId)).deliveries.markUndelivered({ orderId: ids.O2, outcome: 'returned', reason: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('handing over and counting the cash', () => {
  it('two concurrent handovers cannot claim the same collection', async () => {
    const a = await as(repA.userId);
    await a.deliveries.markDelivered({ orderId: ids.O3, collected: '50', idempotencyKey: 'k-3' });
    const results = await Promise.allSettled([
      a.deliveries.submitHandover({ declared: '164', idempotencyKey: 'h-1' }),
      a.deliveries.submitHandover({ declared: '164', idempotencyKey: 'h-2' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const { id } = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof a.deliveries.submitHandover>>>).value.data;
    ids.H1 = id;
    const [handover] = await testDb.select().from(repCashHandovers).where(eq(repCashHandovers.id, id));
    expect(handover.expectedMinor).toBe(16400n);
    expect(handover.declaredMinor).toBe(16400n);
    expect(await code(a.deliveries.submitHandover({ declared: '1', idempotencyKey: 'h-3' }))).toBe('PRECONDITION_FAILED');
    // No money moved yet: the cash is still with the rep.
    expect(await balance('1060')).toBe(16400n);
  });

  it('the count posts what was received, never more than was collected; a shortage is written off separately', async () => {
    const ad = await as(admin.userId);
    expect(await code(ad.repCash.confirm({ handoverId: ids.H1, received: '200', idempotencyKey: 'c-over' }))).toBe('CONFLICT');
    await ad.repCash.confirm({ handoverId: ids.H1, received: '154', idempotencyKey: 'c-1' });
    expect(await code(ad.repCash.confirm({ handoverId: ids.H1, received: '154', idempotencyKey: 'c-2' }))).toBe('CONFLICT');
    expect(await balance('1010')).toBe(15400n);
    expect(await balance('1060')).toBe(1000n);

    // Owner-only by default.
    expect(await code(ad.repCash.writeOffShortage({ handoverId: ids.H1, idempotencyKey: 'w-admin' }))).toBe('FORBIDDEN');
    const ow = await as(owner.userId);
    await ow.repCash.writeOffShortage({ handoverId: ids.H1, idempotencyKey: 'w-1' });
    expect(await code(ow.repCash.writeOffShortage({ handoverId: ids.H1, idempotencyKey: 'w-2' }))).toBe('CONFLICT');
    expect(await balance('1060')).toBe(0n);
    expect(await balance('5030')).toBe(1000n);
    expect(await unbalancedEntries()).toBe(0);
  });

  it('a rep sees only their own cash, and the database will not let them count it', async () => {
    const b = await as(repB.userId);
    expect((await b.deliveries.myCash()).data.handovers).toEqual([]);
    expect(await code(b.repCash.confirm({ handoverId: ids.H1, received: '1', idempotencyKey: 'c-rep' }))).toBe('FORBIDDEN');
  });

  it('a rep with history is suspended, not removed', async () => {
    expect(await code((await as(owner.userId)).members.remove({ memberId: repA.memberId }))).toBe('PRECONDITION_FAILED');
  });
});
