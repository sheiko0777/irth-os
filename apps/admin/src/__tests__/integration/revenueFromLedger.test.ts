/**
 * CLAUDE.md rule 2 end to end: every revenue figure a person reads comes from
 * the ledger, not from summing orders.
 *
 * Real Postgres, real postings: the sale is booked by postOrderDeliveredEntry
 * and the refund by the returns router — the same code production runs — and
 * then the dashboard, analytics, VAT report and finance AI answer are read
 * through their routers. Three things must NOT move the numbers:
 *   - a delivered order whose sale was never posted (a record of intent only)
 *   - a blocked import (0073), whatever its total
 *   - another org's sales
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  orderReturns, orders, organizations, postOrderDeliveredEntry, salesTotals, withOrgContext,
} from '@irth/db';
import { EGP, EGYPT_VAT_BP, formatMoney, fromMinor, netOfTax, taxIncludedIn } from '@irth/domain';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { dashboardRouter } = await import('@/server/routers/dashboard');
const { analyticsRouter } = await import('@/server/routers/analytics');
const { financeRouter } = await import('@/server/routers/finance');
const { returnsRouter } = await import('@/server/routers/returns');

const SALE_GROSS = 11400n;   // 114.00 incl. 14% VAT → 100.00 net + 14.00 VAT
const REFUND_GROSS = 2280n;  // 22.80 incl. VAT → 20.00 net + 2.80 VAT

let orgA: string;
let orgB: string;
let seq = 0;

function ctxFor(orgId: string) {
  return {
    db: testDb, orgId, userId: 'owner-user', role: 'owner',
    session: { user: { id: 'owner-user', email: 'owner@test.com' } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context;
}

async function deliveredAndPosted(orgId: string, gross: bigint) {
  const [order] = await testDb.insert(orders).values({
    orgId, orderNumber: `REV-${++seq}`, status: 'delivered', totalAmountMinor: gross, currency: 'EGP', paymentMethod: 'cod',
  }).returning();
  await withOrgContext(testDb, orgId, (tx) => postOrderDeliveredEntry(tx, {
    orgId, order, previousStatus: 'shipped', newStatus: 'delivered', createdBy: null,
  }));
  return order;
}

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations).values({ name: 'Revenue A', slug: `rev-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Revenue B', slug: `rev-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;

  // Booked sale, then a partial refund through the real returns router.
  const sold = await deliveredAndPosted(orgA, SALE_GROSS);
  const [ret] = await testDb.insert(orderReturns).values({
    orgId: orgA, orderId: sold.id, returnNumber: `RMA-${seq}`, reason: 'other',
  }).returning();
  await returnsRouter.createCaller(ctxFor(orgA)).updateStatus({ id: ret.id, status: 'refunded', refundAmount: '22.80' });

  // Must not count: delivered but never posted, and a blocked import.
  await testDb.insert(orders).values([
    { orgId: orgA, orderNumber: `REV-${++seq}`, status: 'delivered', totalAmountMinor: 500000n, currency: 'EGP' },
    { orgId: orgA, orderNumber: `REV-${++seq}`, status: 'confirmed', totalAmountMinor: 999900n, currency: 'EGP', importStatus: 'blocked' },
  ]);

  // Must not count: another tenant's sale.
  await deliveredAndPosted(orgB, 5000000n);
});
afterAll(async () => { await closeTestDb(); });

const sale = fromMinor(SALE_GROSS, EGP);
const refund = fromMinor(REFUND_GROSS, EGP);
const EXPECTED_NET = netOfTax(sale, EGYPT_VAT_BP).minor - netOfTax(refund, EGYPT_VAT_BP).minor;
const EXPECTED_VAT = taxIncludedIn(sale, EGYPT_VAT_BP).minor - taxIncludedIn(refund, EGYPT_VAT_BP).minor;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

describe('salesTotals', () => {
  it('is net sales less returns, with VAT and gross, for this org only', async () => {
    expect(EXPECTED_NET).toBe(8000n);
    expect(EXPECTED_VAT).toBe(1120n);
    const totals = await withOrgContext(testDb, orgA, (tx) => salesTotals(tx, orgA, { from: startOfToday() }));
    expect(totals).toEqual({ netSalesMinor: EXPECTED_NET, vatMinor: EXPECTED_VAT, grossSalesMinor: EXPECTED_NET + EXPECTED_VAT });
  });

  it('excludes other currencies instead of adding them as if they were EGP', async () => {
    const totals = await withOrgContext(testDb, orgA, (tx) => salesTotals(tx, orgA, { from: startOfToday(), currency: 'EUR' }));
    expect(totals.netSalesMinor).toBe(0n);
  });
});

describe('every revenue screen reads the same ledger figure', () => {
  it('dashboard: net sales today and the last point of its trend line', async () => {
    const { data } = await dashboardRouter.createCaller(ctxFor(orgA)).getStats();
    expect(data.revenueToday).toEqual(fromMinor(EXPECTED_NET));
    expect(data.series.revenue.at(-1)).toBe(80);
  });

  it('analytics: KPI cards and the daily series', async () => {
    const caller = analyticsRouter.createCaller(ctxFor(orgA));
    const { data: kpi } = await caller.kpiSummary();
    expect(kpi.revenueToday).toBe(80);
    expect(kpi.revenueThisMonth).toBe(80);
    const { data: series } = await caller.revenue({ days: 7 });
    expect(series.reduce((s, r) => s + r.revenue, 0)).toBe(80);
  });

  it('VAT report: the VAT the ledger booked, net of the refund', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await financeRouter.createCaller(ctxFor(orgA)).vatReport({ startDate: today, endDate: today });
    expect(data.netRevenue).toEqual(fromMinor(EXPECTED_NET));
    expect(data.vatAmount).toEqual(fromMinor(EXPECTED_VAT));
    expect(data.grossRevenue).toEqual(fromMinor(EXPECTED_NET + EXPECTED_VAT));
  });

  it('finance AI answer states the same figure', async () => {
    const { data } = await financeRouter.createCaller(ctxFor(orgA)).askAi({ question: 'revenue' });
    expect(JSON.stringify(data)).toContain(formatMoney(fromMinor(EXPECTED_NET)));
  });
});
