/**
 * PR-3 against real Postgres, through the real createContext: a supplier's
 * portal account sees only its own purchase orders — in the code and, when a
 * query forgets, in the database (0076/0079) — answers them, announces
 * shipments no larger than what is left, and sees what it is owed, read from
 * the ledger it cannot otherwise touch. The office pays it, never more than is
 * owed, once per key, and every entry balances.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  accessRoles, inventoryItems, journalLines, memberScopes, orgMembers, organizations, productVariants, products,
  purchaseOrderItems, purchaseOrders, supplierPayments, suppliers, withOrgContext,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { verifySession } = await import('@/lib/auth');
const { createContext } = await import('@/server/trpc');
const { appRouter } = await import('@/server/routers/_app');

let org: string;
const ids: Record<string, string> = {};

async function as(userId: string) {
  vi.mocked(verifySession).mockResolvedValue({ user: { id: userId, email: `${userId}@test.com` } } as never);
  return appRouter.createCaller(await createContext());
}

async function code(p: Promise<unknown>) {
  try { await p; return 'OK'; } catch (err) { return err instanceof TRPCError ? err.code : String(err); }
}

async function balance(accountCode: string): Promise<bigint> {
  const [row] = await testDb.execute<{ b: string | null }>(sql`
    SELECT SUM(l.debit_minor - l.credit_minor)::text AS b
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.org_id = ${org} AND a.code = ${accountCode}`);
  return BigInt(row?.b ?? '0');
}

async function po(poNumber: string, supplierId: string, status: string, lines: Array<[string, number, bigint]>) {
  const [row] = await testDb.insert(purchaseOrders).values({ orgId: org, poNumber, supplierId, status, notes: 'ملاحظة داخلية سرية', totalAmountMinor: 0n }).returning();
  const items: string[] = [];
  for (const [sku, quantity, unitCostMinor] of lines) {
    const [i] = await testDb.insert(purchaseOrderItems).values({ orgId: org, poId: row.id, productName: `منتج ${sku}`, sku, quantity, unitCostMinor }).returning();
    items.push(i.id);
  }
  return { id: row.id, items };
}

let supplierUser: string;

beforeAll(async () => {
  await truncateAll();
  const [o] = await testDb.insert(organizations).values({ name: 'Suppliers', slug: `sup-${Date.now()}` }).returning();
  org = o.id;
  await testDb.insert(orgMembers).values([
    { orgId: org, userId: 'sp-owner', role: 'owner' },
    { orgId: org, userId: 'sp-admin', role: 'admin' },
    { orgId: org, userId: 'sp-staff', role: 'member' },
  ]);
  for (const key of ['S1', 'S2']) {
    const [s] = await testDb.insert(suppliers).values({ orgId: org, name: `مورد ${key}` }).returning();
    ids[key] = s.id;
  }
  const [p] = await testDb.insert(products).values({ orgId: org, name: 'خامة', sku: 'RAW', priceMinor: 5000n }).returning();
  for (const sku of ['A', 'B']) {
    const [v] = await testDb.insert(productVariants).values({ orgId: org, productId: p.id, sku, name: sku }).returning();
    await testDb.insert(inventoryItems).values({ orgId: org, variantId: v.id, quantity: 0 });
  }
  const po1 = await po('PO-1', ids.S1, 'ordered', [['A', 10, 1000n], ['B', 5, 2000n]]);
  ids.PO1 = po1.id; ids.PO1A = po1.items[0]; ids.PO1B = po1.items[1];
  ids.PO2 = (await po('PO-2', ids.S2, 'ordered', [['A', 3, 1000n]])).id;
  ids.PO3 = (await po('PO-3', ids.S1, 'draft', [['A', 1, 1000n]])).id;
  ids.PO4 = (await po('PO-4', ids.S1, 'ordered', [['B', 2, 2000n]])).id;
});
afterAll(async () => { await closeTestDb(); });

describe('opening a portal account', () => {
  it('the office opens one for a supplier: kind supplier, the مورد role, scoped to exactly that supplier', async () => {
    const admin = await as('sp-admin');
    const { data } = await admin.purchasing.suppliers.createPortalAccount({ supplierId: ids.S1, name: 'مندوب المورد', username: 'supplier_one' });
    expect(data.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    const [m] = await testDb.select().from(orgMembers).where(eq(orgMembers.id, data.memberId));
    expect(m.principalKind).toBe('supplier');
    expect(m.mustChangePassword).toBe(true);
    const scopes = await testDb.select().from(memberScopes).where(eq(memberScopes.memberId, m.id));
    expect(scopes.map((s) => [s.scopeKind, s.scopeId])).toEqual([['supplier', ids.S1]]);
    const [role] = await testDb.select().from(accessRoles).where(eq(accessRoles.id, m.accessRoleId as string));
    expect(role).toMatchObject({ name: 'مورد', principalKind: 'supplier', permissions: { portal: ['view', 'respond', 'ship', 'payments'] } });
    // Skip the first-sign-in password change for the rest of this suite.
    await testDb.update(orgMembers).set({ mustChangePassword: false }).where(eq(orgMembers.id, m.id));
    supplierUser = m.userId;
    expect(await code((await as('sp-staff')).purchasing.suppliers.createPortalAccount({ supplierId: ids.S2, name: 'x', username: 'supplier_two' }))).toBe('FORBIDDEN');
  });
});

describe('a supplier sees only their own orders', () => {
  it('in the portal: their sent orders only, no internal notes, and none of the admin screens', async () => {
    const s = await as(supplierUser);
    const orders = (await s.portal.orders()).data;
    expect(orders.map((o) => o.poNumber).sort()).toEqual(['PO-1', 'PO-4']);
    expect(await code(s.portal.get({ id: ids.PO2 }))).toBe('NOT_FOUND');
    expect(await code(s.portal.get({ id: ids.PO3 }))).toBe('NOT_FOUND');
    const detail = (await s.portal.get({ id: ids.PO1 })).data;
    expect(JSON.stringify(detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('ملاحظة داخلية');
    expect(detail.items.map((i) => i.unitPriceMinor)).toEqual([1000n, 2000n]);
    expect(await code(s.purchasing.po.list({}))).toBe('FORBIDDEN');
    expect(await code(s.orders.list({}))).toBe('FORBIDDEN');
    // A staff member is not a supplier, whatever they hold.
    expect(await code((await as('sp-owner')).portal.orders())).toBe('PRECONDITION_FAILED');
  });

  it('the database alone: a supplier transaction sees its own orders, nothing without a scope, and no ledger', async () => {
    const supplierTx = { brand: [], pricelist: [], principalKind: 'supplier' as const, memberId: null };
    const mine = await withOrgContext(testDb, org, (tx) => tx.select({ n: purchaseOrders.poNumber }).from(purchaseOrders), { ...supplierTx, supplier: [ids.S1] });
    expect(mine.map((r) => r.n).sort()).toEqual(['PO-1', 'PO-3', 'PO-4']);
    expect(await withOrgContext(testDb, org, (tx) => tx.select({ n: purchaseOrders.poNumber }).from(purchaseOrders), { ...supplierTx, supplier: [] })).toEqual([]);
    expect(await withOrgContext(testDb, org, (tx) => tx.select({ n: suppliers.name }).from(suppliers), { ...supplierTx, supplier: [] })).toEqual([]);
    // Anyone else with no scope still sees everything.
    const staff = await withOrgContext(testDb, org, (tx) => tx.select({ n: purchaseOrders.poNumber }).from(purchaseOrders), { brand: [], supplier: [], pricelist: [], principalKind: 'staff' });
    expect(staff).toHaveLength(4);
  });
});

describe('answering an order', () => {
  it('confirms once; a proposed date waits for the buyer, who accepts or rejects it', async () => {
    const s = await as(supplierUser);
    await s.portal.confirm({ poId: ids.PO1 });
    expect(await code(s.portal.confirm({ poId: ids.PO1 }))).toBe('CONFLICT');
    expect(await code(s.portal.confirm({ poId: ids.PO2 }))).toBe('CONFLICT');

    const when = new Date(Date.now() + 7 * 86_400_000);
    await s.portal.proposeDate({ poId: ids.PO4, date: when, note: 'المصنع متأخر أسبوع' });
    const admin = await as('sp-admin');
    await admin.purchasing.po.acceptProposedDate({ id: ids.PO4 });
    const [row] = await testDb.select().from(purchaseOrders).where(eq(purchaseOrders.id, ids.PO4));
    expect(row.supplierStatus).toBe('confirmed');
    expect(row.expectedDeliveryAt?.getTime()).toBe(when.getTime());
    expect(await code(admin.purchasing.po.acceptProposedDate({ id: ids.PO4 }))).toBe('CONFLICT');
  });
});

describe('shipping notices', () => {
  it('announce no more than is left on each line, even when two are sent at once', async () => {
    const s = await as(supplierUser);
    await s.portal.shipNotice({ poId: ids.PO1, lines: [{ poItemId: ids.PO1A, quantity: 6 }], reference: 'BOL-1', idempotencyKey: 'asn-1' });
    expect(await code(s.portal.shipNotice({ poId: ids.PO1, lines: [{ poItemId: ids.PO1A, quantity: 5 }], idempotencyKey: 'asn-2' }))).toBe('BAD_REQUEST');
    const both = await Promise.allSettled([
      s.portal.shipNotice({ poId: ids.PO1, lines: [{ poItemId: ids.PO1A, quantity: 4 }], idempotencyKey: 'asn-3' }),
      s.portal.shipNotice({ poId: ids.PO1, lines: [{ poItemId: ids.PO1A, quantity: 4 }], idempotencyKey: 'asn-4' }),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const detail = (await s.portal.get({ id: ids.PO1 })).data;
    expect(detail.items.find((i) => i.id === ids.PO1A)?.shippedQuantity).toBe(10);
    expect(await code(s.portal.shipNotice({ poId: ids.PO2, lines: [{ poItemId: ids.PO1A, quantity: 1 }], idempotencyKey: 'asn-5' }))).toBe('NOT_FOUND');
    const admin = await as('sp-admin');
    expect((await admin.purchasing.po.shipments({ id: ids.PO1 })).data).toHaveLength(2);
  });
});

describe('paying suppliers', () => {
  it('pays against what the ledger says is owed, once per key, and the supplier sees the balance', async () => {
    const admin = await as('sp-admin');
    await admin.purchasing.po.receive({ id: ids.PO1, items: [{ id: ids.PO1A, receivedQuantity: 6, updateInventory: true }], idempotencyKey: 'rcv-1' });
    expect((await admin.purchasing.suppliers.statement({ supplierId: ids.S1 })).data.outstandingMinor).toBe(6000n);

    expect(await code(admin.purchasing.suppliers.recordPayment({ supplierId: ids.S1, amount: '70', method: 'bank', idempotencyKey: 'pay-0' }))).toBe('BAD_REQUEST');
    expect(await code(admin.purchasing.suppliers.recordPayment({ supplierId: ids.S1, poId: ids.PO4, amount: '1', method: 'bank', idempotencyKey: 'pay-x' }))).toBe('BAD_REQUEST');
    const first = await admin.purchasing.suppliers.recordPayment({ supplierId: ids.S1, poId: ids.PO1, amount: '40', method: 'bank', idempotencyKey: 'pay-1' });
    const replay = await admin.purchasing.suppliers.recordPayment({ supplierId: ids.S1, poId: ids.PO1, amount: '40', method: 'bank', idempotencyKey: 'pay-1' });
    expect(replay).toEqual(first);
    expect(await testDb.select().from(supplierPayments).where(eq(supplierPayments.orgId, org))).toHaveLength(1);
    expect(await code((await as('sp-staff')).purchasing.suppliers.recordPayment({ supplierId: ids.S1, amount: '1', method: 'cash', idempotencyKey: 'pay-2' }))).toBe('FORBIDDEN');

    expect(await balance('2010')).toBe(-2000n); // credit balance: 60.00 owed − 40.00 paid
    expect(await balance('1020')).toBe(-4000n);
    const unbalanced = await testDb.execute(sql`SELECT entry_id FROM journal_lines WHERE org_id = ${org} GROUP BY entry_id HAVING SUM(debit_minor) <> SUM(credit_minor)`);
    expect([...unbalanced]).toEqual([]);

    const s = await as(supplierUser);
    const st = (await s.portal.statement()).data;
    expect(st).toMatchObject({ receivedMinor: 6000n, paidMinor: 4000n, outstandingMinor: 2000n });
    expect(st.rows.find((r) => r.poNumber === 'PO-1')).toMatchObject({ receivedMinor: 6000n, paidMinor: 4000n });
  });

  it('the ledger stays closed to a supplier account; its statement answers only for its own supplier', async () => {
    const supplierTx = { brand: [], pricelist: [], principalKind: 'supplier' as const, memberId: null, supplier: [ids.S1] };
    expect(await withOrgContext(testDb, org, (tx) => tx.select({ id: journalLines.id }).from(journalLines), supplierTx)).toEqual([]);
    const other = await withOrgContext(testDb, org, (tx) => tx.execute(sql`SELECT * FROM supplier_statement(${ids.S2}::uuid)`), supplierTx);
    expect([...other]).toEqual([]);
    const [p] = await testDb.select().from(supplierPayments).where(and(eq(supplierPayments.orgId, org)));
    expect(p.amountMinor).toBe(4000n);
  });
});
