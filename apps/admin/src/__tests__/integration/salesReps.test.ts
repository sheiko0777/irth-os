/**
 * PR-2b against real Postgres, through the real createContext: a sales rep
 * sees only their own customers, orders and quotes — in the code and, when a
 * query forgets, in the database (0078) — sells only at the price lists they
 * may use, at prices the server computes, and every order they place takes
 * stock exactly once however often the request is retried.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  accessRoles, customers, inventoryItems, memberScopes, orderItems, orders, orgMembers, organizations, priceListItems, priceLists,
  productVariants, products, salesQuotes, withOrgContext,
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

type M = { userId: string; memberId: string };
async function member(kind: 'owner' | 'admin' | 'rep' | 'staff'): Promise<M> {
  const userId = `sales-user-${++seq}`;
  const role = kind === 'owner' ? 'owner' : kind === 'admin' ? 'admin' : 'member';
  const [m] = await testDb.insert(orgMembers).values({ orgId: org, userId, role }).returning();
  if (kind === 'rep') {
    await testDb.update(orgMembers).set({ accessRoleId: ids.repRole, principalKind: 'sales_rep' }).where(eq(orgMembers.id, m.id));
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

async function stock(variantId: string) {
  const [row] = await testDb.select({ q: inventoryItems.quantity }).from(inventoryItems).where(eq(inventoryItems.variantId, variantId));
  return row.q;
}

let admin: M, repA: M, repB: M, staff: M;

beforeAll(async () => {
  await truncateAll();
  const [o] = await testDb.insert(organizations).values({ name: 'Sales', slug: `sales-${Date.now()}` }).returning();
  org = o.id;
  const [role] = await testDb.insert(accessRoles).values({
    orgId: org, name: 'مندوب مبيعات', principalKind: 'sales_rep',
    permissions: { sales: ['view', 'customers', 'order', 'quote'], sensitive: ['customerContact'] },
  }).returning();
  ids.repRole = role.id;
  await member('owner');
  admin = await member('admin');
  repA = await member('rep');
  repB = await member('rep');
  staff = await member('staff');

  for (const [key, rep] of [['C1', repA.memberId], ['C2', repB.memberId], ['C3', null]] as const) {
    const [c] = await testDb.insert(customers).values({ orgId: org, name: `عميل ${key}`, phone: '0100', address: 'القاهرة', salesRepMemberId: rep }).returning();
    ids[key] = c.id;
  }
  const [p] = await testDb.insert(products).values({ orgId: org, name: 'كريم', sku: 'CR', priceMinor: 10000n }).returning();
  ids.P = p.id;
  const [v1] = await testDb.insert(productVariants).values({ orgId: org, productId: p.id, sku: 'CR-1', name: 'صغير' }).returning();
  const [v2] = await testDb.insert(productVariants).values({ orgId: org, productId: p.id, sku: 'CR-2', name: 'كبير', priceMinor: 20000n }).returning();
  ids.V1 = v1.id; ids.V2 = v2.id;
  await testDb.insert(inventoryItems).values([
    { orgId: org, variantId: v1.id, quantity: 10, averageCostMinor: 6000n },
    { orgId: org, variantId: v2.id, quantity: 10, averageCostMinor: 12000n },
  ]);
  const day = 86_400_000;
  const lists = [
    { key: 'L1', name: 'خصم 10%', discountBp: 1000 },
    { key: 'L2', name: 'جملة', discountBp: null },
    { key: 'L3', name: 'منتهية', discountBp: 500, endDate: new Date(Date.now() - day) },
    { key: 'L4', name: 'مش مسموحة', discountBp: 5000 },
  ];
  for (const l of lists) {
    const [row] = await testDb.insert(priceLists).values({ orgId: org, name: l.name, discountBp: l.discountBp, endDate: l.endDate ?? null }).returning();
    ids[l.key] = row.id;
  }
  await testDb.insert(priceListItems).values({ orgId: org, priceListId: ids.L2, productId: p.id, variantId: v2.id, priceMinor: 15000n });
  await testDb.insert(memberScopes).values(['L1', 'L2', 'L3'].map((k) => ({ orgId: org, memberId: repA.memberId, scopeKind: 'pricelist' as const, scopeId: ids[k] })));
});
afterAll(async () => { await closeTestDb(); });

describe('a sales rep sees only their own book', () => {
  it('customers, and the price lists they may use', async () => {
    const a = await as(repA.userId);
    expect((await a.sales.customers({})).data.map((c) => c.name)).toEqual(['عميل C1']);
    expect((await a.sales.priceLists()).data.map((l) => l.name).sort()).toEqual(['جملة', 'خصم 10%']);
    // Granted customers.view, still only their own.
    await testDb.update(orgMembers).set({ overrides: { grant: { customers: ['view'] } } }).where(eq(orgMembers.id, repA.memberId));
    const granted = await as(repA.userId);
    expect((await granted.customers.list({})).data.map((c) => c.name)).toEqual(['عميل C1']);
    expect(await code(granted.customers.get({ id: ids.C2 }))).toBe('NOT_FOUND');
    await testDb.update(orgMembers).set({ overrides: {} }).where(eq(orgMembers.id, repA.memberId));
  });

  it('the database alone holds it, and fails closed without a member id', async () => {
    const settings = { brand: [], supplier: [], pricelist: [], principalKind: 'sales_rep' as const };
    const seen = await withOrgContext(testDb, org, (tx) => tx.select({ n: customers.name }).from(customers), { ...settings, memberId: repA.memberId });
    expect(seen.map((r) => r.n)).toEqual(['عميل C1']);
    expect(await withOrgContext(testDb, org, (tx) => tx.select({ n: customers.name }).from(customers), { ...settings, memberId: null })).toEqual([]);
    // Cannot write a customer into someone else's book.
    await expect(withOrgContext(testDb, org, (tx) => tx.insert(customers).values({ orgId: org, name: 'x', salesRepMemberId: repB.memberId }),
      { ...settings, memberId: repA.memberId })).rejects.toBeTruthy();
    // A price-list scope narrows price lists for anyone.
    const lists = await withOrgContext(testDb, org, (tx) => tx.select({ id: priceLists.id }).from(priceLists),
      { brand: [], supplier: [], pricelist: [ids.L1], principalKind: 'staff', memberId: staff.memberId });
    expect(lists.map((l) => l.id)).toEqual([ids.L1]);
  });
});

describe('pricing', () => {
  it('the server prices from the list: a percentage per unit, or the list\'s own price', async () => {
    const a = await as(repA.userId);
    const byL1 = new Map((await a.sales.catalog({ priceListId: ids.L1 })).data.map((v) => [v.sku, v]));
    expect(byL1.get('CR-1')).toMatchObject({ listPriceMinor: 10000n, unitPriceMinor: 9000n });
    expect(byL1.get('CR-2')).toMatchObject({ listPriceMinor: 20000n, unitPriceMinor: 18000n });
    const byL2 = new Map((await a.sales.catalog({ priceListId: ids.L2 })).data.map((v) => [v.sku, v]));
    expect(byL2.get('CR-1')).toMatchObject({ unitPriceMinor: 10000n });
    expect(byL2.get('CR-2')).toMatchObject({ unitPriceMinor: 15000n });
    expect(await code(a.sales.catalog({ priceListId: ids.L4 }))).toBe('FORBIDDEN');
    expect(await code(a.sales.catalog({ priceListId: ids.L3 }))).toBe('PRECONDITION_FAILED');
  });
});

describe('placing orders', () => {
  it('prices on the server, takes stock once, and records who placed it for whom', async () => {
    const a = await as(repA.userId);
    const input = { customerId: ids.C1, priceListId: ids.L1, lines: [{ variantId: ids.V1, quantity: 3 }, { variantId: ids.V2, quantity: 1 }], idempotencyKey: 'o-1' };
    const first = await a.sales.placeOrder(input);
    const replay = await a.sales.placeOrder(input);
    expect(replay).toEqual(first);
    const [order] = await testDb.select().from(orders).where(eq(orders.id, first.data.id));
    expect(order).toMatchObject({ totalAmountMinor: 45000n, subtotalMinor: 50000n, discountMinor: 5000n, customerId: ids.C1, createdByMemberId: repA.memberId });
    expect(order.buyer).toMatchObject({ name: 'عميل C1' });
    const lines = await testDb.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines.reduce((s, l) => s + l.priceMinor * BigInt(l.quantity), 0n)).toBe(order.totalAmountMinor);
    expect(await stock(ids.V1)).toBe(7);
    expect(await stock(ids.V2)).toBe(9);
    ids.O1 = order.id;
  });

  it('refuses someone else\'s customer, a list they may not use, and more than is in stock — taking nothing', async () => {
    const a = await as(repA.userId);
    const base = { lines: [{ variantId: ids.V1, quantity: 1 }], priceListId: null };
    expect(await code(a.sales.placeOrder({ ...base, customerId: ids.C2, idempotencyKey: 'o-2' }))).toBe('NOT_FOUND');
    expect(await code(a.sales.placeOrder({ ...base, customerId: ids.C1, priceListId: ids.L4, idempotencyKey: 'o-3' }))).toBe('FORBIDDEN');
    expect(await code(a.sales.placeOrder({ customerId: ids.C1, priceListId: null, lines: [{ variantId: ids.V1, quantity: 99 }], idempotencyKey: 'o-4' }))).toBe('CONFLICT');
    expect(await stock(ids.V1)).toBe(7);
  });

  it('another rep sees none of it', async () => {
    const b = await as(repB.userId);
    expect((await b.sales.orders()).data).toEqual([]);
    const a = await as(repA.userId);
    expect((await a.sales.orders()).data.map((o) => o.id)).toEqual([ids.O1]);
  });
});

describe('quotes', () => {
  it('a quote moves no stock, converts once at the quoted prices, and not after it expires', async () => {
    const a = await as(repA.userId);
    const q = (await a.sales.createQuote({ customerId: ids.C1, priceListId: ids.L2, lines: [{ variantId: ids.V2, quantity: 2 }], idempotencyKey: 'q-1' })).data;
    expect(q.quoteNumber).toMatch(/^QT-\d{4}-0001$/);
    expect(await stock(ids.V2)).toBe(9);

    const converted = await a.sales.convertQuote({ quoteId: q.id, idempotencyKey: 'c-1' });
    expect(await code(a.sales.convertQuote({ quoteId: q.id, idempotencyKey: 'c-2' }))).toBe('CONFLICT');
    const [order] = await testDb.select().from(orders).where(eq(orders.id, converted.data.id));
    expect(order.totalAmountMinor).toBe(30000n);
    ids.O2 = order.id;
    expect(await stock(ids.V2)).toBe(7);
    const [row] = await testDb.select().from(salesQuotes).where(eq(salesQuotes.id, q.id));
    expect(row).toMatchObject({ status: 'converted', convertedOrderId: order.id });

    const old = (await a.sales.createQuote({ customerId: ids.C1, priceListId: null, lines: [{ variantId: ids.V1, quantity: 1 }], idempotencyKey: 'q-2' })).data;
    await testDb.update(salesQuotes).set({ validUntil: sql`now() - interval '1 day'` }).where(eq(salesQuotes.id, old.id));
    expect(await code(a.sales.convertQuote({ quoteId: old.id, idempotencyKey: 'c-3' }))).toBe('PRECONDITION_FAILED');
    expect(await code((await as(repB.userId)).sales.cancelQuote({ quoteId: old.id }))).toBe('CONFLICT');
  });
});

describe('both layers hold on their own', () => {
  it('the database alone: a rep transaction sees only their orders, with no WHERE of its own', async () => {
    const settings = { brand: [], supplier: [], pricelist: [], principalKind: 'sales_rep' as const };
    const a = await withOrgContext(testDb, org, (tx) => tx.select({ id: orders.id }).from(orders), { ...settings, memberId: repA.memberId });
    expect(a.map((o) => o.id).sort()).toEqual([ids.O1, ids.O2].sort());
    const b = await withOrgContext(testDb, org, (tx) => tx.select({ id: orders.id }).from(orders), { ...settings, memberId: repB.memberId });
    expect(b).toEqual([]);
  });

  it('the real context carries the member\'s price-list scope into the database', async () => {
    vi.mocked(verifySession).mockResolvedValue({ user: { id: repA.userId, email: 'x@test.com' } } as never);
    const ctx = await createContext();
    const seen = await ctx.withOrg((tx) => tx.select({ id: priceLists.id }).from(priceLists));
    expect(seen.map((l) => l.id).sort()).toEqual([ids.L1, ids.L2, ids.L3].sort());
  });

  it('the code alone: with a transaction that carries no rep settings, the procedures still narrow', async () => {
    vi.mocked(verifySession).mockResolvedValue({ user: { id: repA.userId, email: 'x@test.com' } } as never);
    const ctx = await createContext();
    const access = { ...ctx.access, perms: new Set([...ctx.access.perms, 'customers.view', 'orders.view']) };
    const c = appRouter.createCaller({
      ...ctx, access,
      withOrg: <T,>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, org, fn),
    } as unknown as Context);
    expect((await c.customers.list({})).data.map((x) => x.name)).toEqual(['عميل C1']);
    expect(await code(c.customers.get({ id: ids.C2 }))).toBe('NOT_FOUND');
    expect((await c.orders.list({})).data.map((o) => o.id).sort()).toEqual([ids.O1, ids.O2].sort());
    expect((await c.sales.customers({})).data.map((x) => x.name)).toEqual(['عميل C1']);
  });
});

describe('the office hands customers to a rep', () => {
  it('assigns to an active sales rep only; the rep then sees the customer', async () => {
    const ad = await as(admin.userId);
    expect((await ad.customers.salesReps()).data.map((r) => r.memberId).sort()).toEqual([repA.memberId, repB.memberId].sort());
    expect(await code(ad.customers.assignSalesRep({ customerIds: [ids.C3], memberId: staff.memberId }))).toBe('BAD_REQUEST');
    await ad.customers.assignSalesRep({ customerIds: [ids.C3], memberId: repA.memberId });
    expect((await (await as(repA.userId)).sales.customers({})).data.map((c) => c.name).sort()).toEqual(['عميل C1', 'عميل C3']);
    expect(await code((await as(repA.userId)).customers.assignSalesRep({ customerIds: [ids.C2], memberId: repA.memberId }))).toBe('FORBIDDEN');
    const [c2] = await testDb.select({ rep: customers.salesRepMemberId }).from(customers).where(and(eq(customers.id, ids.C2)));
    expect(c2.rep).toBe(repB.memberId);
  });
});
