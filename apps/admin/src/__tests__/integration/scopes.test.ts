/**
 * PR-1e against real Postgres, through the real createContext: a member
 * limited to some brands or suppliers sees nothing outside them — by list,
 * by id, in counts — and the database holds the line even when a query
 * forgets its WHERE (0076). Sensitive fields leave the response for members
 * without the permission.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  accessRoles, auditLog, brands, inventoryItems, memberScopes, orgMembers, organizations, productVariants, products,
  purchaseOrderItems, purchaseOrders, suppliers, withOrgContext,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { verifySession } = await import('@/lib/auth');
const { createContext } = await import('@/server/trpc');
const { appRouter } = await import('@/server/routers/_app');

let org: string;
const ids: Record<string, string> = {};
let seq = 0;

async function member(role: 'owner' | 'admin' | 'member', opts: { accessRoleId?: string; brand?: string[]; supplier?: string[] } = {}) {
  const userId = `scope-user-${++seq}`;
  const [m] = await testDb.insert(orgMembers).values({ orgId: org, userId, role }).returning();
  if (opts.accessRoleId) await testDb.update(orgMembers).set({ accessRoleId: opts.accessRoleId }).where(eq(orgMembers.id, m.id));
  const scopes = [
    ...(opts.brand ?? []).map((id) => ({ scopeKind: 'brand' as const, scopeId: id })),
    ...(opts.supplier ?? []).map((id) => ({ scopeKind: 'supplier' as const, scopeId: id })),
  ];
  if (scopes.length) await testDb.insert(memberScopes).values(scopes.map((s) => ({ ...s, orgId: org, memberId: m.id })));
  return { userId, memberId: m.id };
}

async function as(userId: string) {
  vi.mocked(verifySession).mockResolvedValue({ user: { id: userId, email: `${userId}@test.com` } } as never);
  return appRouter.createCaller(await createContext());
}

async function code(p: Promise<unknown>) {
  try { await p; return 'OK'; } catch (err) { return err instanceof TRPCError ? err.code : String(err); }
}

beforeAll(async () => {
  await truncateAll();
  const [o] = await testDb.insert(organizations).values({ name: 'Scopes', slug: `scopes-${Date.now()}` }).returning();
  org = o.id;
  await testDb.insert(orgMembers).values({ orgId: org, userId: 'scope-owner', role: 'owner' });
  for (const code of ['B1', 'B2']) {
    const [b] = await testDb.insert(brands).values({ orgId: org, code, name: `براند ${code}` }).returning();
    ids[code] = b.id;
  }
  for (const [key, brandId] of [['P1', ids.B1], ['P2', ids.B2]] as const) {
    const [p] = await testDb.insert(products).values({ orgId: org, name: key, sku: key, priceMinor: 1000n, brandId }).returning();
    const [v] = await testDb.insert(productVariants).values({ orgId: org, productId: p.id, sku: `${key}-V`, name: 'افتراضي' }).returning();
    const [i] = await testDb.insert(inventoryItems).values({ orgId: org, variantId: v.id, quantity: 5, averageCostMinor: 600n }).returning();
    ids[key] = p.id;
    ids[`${key}item`] = i.id;
  }
  for (const key of ['S1', 'S2']) {
    const [s] = await testDb.insert(suppliers).values({ orgId: org, name: key }).returning();
    const [po] = await testDb.insert(purchaseOrders).values({ orgId: org, poNumber: `PO-${key}`, supplierId: s.id, totalAmountMinor: 5000n }).returning();
    await testDb.insert(purchaseOrderItems).values({ orgId: org, poId: po.id, productName: 'x', quantity: 1, unitCostMinor: 5000n });
    ids[key] = s.id;
    ids[`PO${key}`] = po.id;
  }
  const [keeper] = await testDb.insert(accessRoles).values({
    orgId: org, name: 'أمين مخزن', permissions: { products: ['view'], inventory: ['view'], purchasing: ['view'], analytics: ['view'] },
  }).returning();
  ids.keeperRole = keeper.id;
});
afterAll(async () => { await closeTestDb(); });

describe('brand scope', () => {
  it('lists, counts and fetches only the member\'s brands', async () => {
    const { userId } = await member('member', { accessRoleId: ids.keeperRole, brand: [ids.B1] });
    const c = await as(userId);
    const { data: list } = await c.products.list({});
    expect(list.map((p) => p.name)).toEqual(['P1']);
    expect(await code(c.products.getById({ id: ids.P2 }))).toBe('NOT_FOUND');
    const inv = await c.inventory.list({});
    expect(inv.data.map((r) => r.product.name)).toEqual(['P1']);
    expect(inv.meta.counts.all).toBe(1);
    expect((await c.inventory.movements({ itemId: ids.P2item })).data).toEqual([]);
    // No scope WHERE in this raw query: only the database (the scopes that
    // ctx.withOrg passes to 0076's policies) keeps brand B2 out.
    const turnover = await c.analytics.inventoryTurnover({ days: 30 });
    expect(turnover.data.map((r) => r.product)).toEqual(['P1']);
  });

  it('an unscoped member sees both brands', async () => {
    const { userId } = await member('member', { accessRoleId: ids.keeperRole });
    const { data } = await (await as(userId)).products.list({});
    expect(data.map((p) => p.name).sort()).toEqual(['P1', 'P2']);
  });

  it('the database alone holds the scope: a query with no scope WHERE still sees one brand', async () => {
    const seen = await withOrgContext(testDb, org, (tx) => tx.select({ name: products.name }).from(products), { brand: [ids.B1], supplier: [], pricelist: [] });
    expect(seen.map((p) => p.name)).toEqual(['P1']);
    const stock = await withOrgContext(testDb, org, (tx) => tx.select({ id: inventoryItems.id }).from(inventoryItems), { brand: [ids.B1], supplier: [], pricelist: [] });
    expect(stock.map((s) => s.id)).toEqual([ids.P1item]);
    await expect(withOrgContext(testDb, org, (tx) => tx.insert(products).values({ orgId: org, name: 'X', sku: 'X', priceMinor: 1n, brandId: ids.B2 }), { brand: [ids.B1], supplier: [], pricelist: [] }))
      .rejects.toBeTruthy();
  });
});

describe('supplier scope', () => {
  it('lists and fetches only the member\'s suppliers and their purchase orders', async () => {
    const { userId } = await member('member', { accessRoleId: ids.keeperRole, supplier: [ids.S1] });
    const c = await as(userId);
    expect((await c.purchasing.suppliers.list()).data.map((s) => s.name)).toEqual(['S1']);
    const pos = await c.purchasing.po.list({});
    expect(pos.data.map((p) => p.poNumber)).toEqual(['PO-S1']);
    expect(pos.meta.total).toBe(1);
    expect(await code(c.purchasing.po.get({ id: ids.POS2 }))).toBe('NOT_FOUND');
    const lines = await withOrgContext(testDb, org, (tx) => tx.select({ po: purchaseOrderItems.poId }).from(purchaseOrderItems), { brand: [], supplier: [ids.S1] });
    expect(lines.map((l) => l.po)).toEqual([ids.POS1]);
  });
});

describe('assigning scopes', () => {
  it('the owner sets a scope; nobody sets one wider than their own; accounts they create inherit it', async () => {
    const target = await member('member', { accessRoleId: ids.keeperRole });
    const owner = await as('scope-owner');
    await owner.accounts.setScopes({ memberId: target.memberId, brand: [ids.B1], supplier: [], pricelist: [] });
    expect((await owner.accounts.effective({ memberId: target.memberId })).data.scopes).toEqual({ brand: [ids.B1], supplier: [], pricelist: [] });
    const [audit] = await testDb.select().from(auditLog).where(and(eq(auditLog.orgId, org), eq(auditLog.action, 'SET_MEMBER_SCOPES')));
    expect(audit).toBeTruthy();

    // A manager limited to B1, with the right to manage members.
    const [mgrRole] = await testDb.insert(accessRoles).values({
      orgId: org, name: 'مدير براند', permissions: { members: ['view', 'changeRole', 'create'], products: ['view'], inventory: ['view'], purchasing: ['view'], analytics: ['view'] },
    }).returning();
    const mgr = await member('member', { accessRoleId: mgrRole.id, brand: [ids.B1] });
    const other = await member('member', { accessRoleId: ids.keeperRole, brand: [ids.B1] });
    const m = await as(mgr.userId);
    expect(await code(m.accounts.setScopes({ memberId: other.memberId, brand: [ids.B1, ids.B2], supplier: [], pricelist: [] }))).toBe('FORBIDDEN');
    expect(await code(m.accounts.setScopes({ memberId: other.memberId, brand: [], supplier: [], pricelist: [] }))).toBe('FORBIDDEN');
    expect(await code(m.accounts.setScopes({ memberId: other.memberId, brand: [ids.B1], supplier: [], pricelist: [] }))).toBe('OK');
    // …and cannot manage someone unscoped (who sees more than the manager).
    expect(await code(m.accounts.setScopes({ memberId: target.memberId, brand: [ids.B1], supplier: [], pricelist: [] }))).toBe('OK');
    const unscoped = await member('member', { accessRoleId: ids.keeperRole });
    expect(await code(m.accounts.setScopes({ memberId: unscoped.memberId, brand: [ids.B1], supplier: [], pricelist: [] }))).toBe('FORBIDDEN');

    const { data } = await m.accounts.create({ name: 'تابع', username: 'scoped_child', accessRoleId: ids.keeperRole });
    const inherited = await testDb.select().from(memberScopes).where(eq(memberScopes.memberId, data.memberId));
    expect(inherited.map((r) => [r.scopeKind, r.scopeId])).toEqual([['brand', ids.B1]]);
  });
});

describe('sensitive fields', () => {
  it('a موظف gets stock without cost and purchase orders without supplier prices; an admin gets both', async () => {
    const staff = await as((await member('member')).userId);
    const staffInv = await staff.inventory.list({});
    expect(staffInv.data.length).toBeGreaterThan(0);
    expect(staffInv.data.every((r) => !('averageCostMinor' in r.item))).toBe(true);
    const staffPo = await staff.purchasing.po.get({ id: ids.POS1 });
    expect(JSON.stringify(staffPo, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/unitCostMinor|totalAmountMinor/);

    const admin = await as((await member('admin')).userId);
    const adminInv = await admin.inventory.list({});
    expect(adminInv.data.every((r) => r.item.averageCostMinor === 600n)).toBe(true);
    const adminPo = (await admin.purchasing.po.get({ id: ids.POS1 })).data;
    expect(adminPo.totalAmountMinor).toBe(5000n);
    expect(adminPo.items[0].unitCostMinor).toBe(5000n);
  });
});
