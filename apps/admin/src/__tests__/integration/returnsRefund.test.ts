import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { journalEntries, orders, orderReturns, organizations, withOrgContext } from '@irth/db';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { returnsRouter } = await import('@/server/routers/returns');
let orgId: string;
let sequence = 0;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Refund race', slug: `refund-race-${Date.now()}` }).returning();
  orgId = org.id;
});
afterAll(async () => { await closeTestDb(); });

async function fixture(count = 1) {
  const [order] = await testDb.insert(orders).values({
    orgId, orderNumber: `REFUND-${++sequence}`, status: 'delivered', totalAmountMinor: 2000n, currency: 'EGP',
  }).returning();
  const returns = await testDb.insert(orderReturns).values(Array.from({ length: count }, (_, index) => ({
    orgId, orderId: order.id, returnNumber: `RMA-${sequence}-${index}`, reason: 'other' as const,
  }))).returning();
  expect(returns.every(row => row.refundPostedAt === null)).toBe(true);
  const caller = returnsRouter.createCaller({
    db: testDb, orgId, userId: 'refund-user', role: 'owner',
    session: { user: { id: 'refund-user', email: 'refund@test.com' } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context);
  return { caller, returns };
}

async function entries(id: string) {
  return testDb.select().from(journalEntries).where(and(
    eq(journalEntries.orgId, orgId), eq(journalEntries.sourceTable, 'order_returns'), eq(journalEntries.sourceId, id),
  ));
}

async function returned(id: string) {
  const [row] = await testDb.select().from(orderReturns)
    .where(and(eq(orderReturns.orgId, orgId), eq(orderReturns.id, id)));
  return row;
}

describe('refund posting through the real router', () => {
  it('allows ten concurrent retries but posts exactly once', async () => {
    const { caller, returns: [row] } = await fixture();
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      caller.updateStatus({ id: row.id, status: 'refunded', refundAmount: '20' }),
    ));
    expect(results).toHaveLength(10);
    expect(results.every(result => result.error === null)).toBe(true);
    expect(await entries(row.id)).toHaveLength(1);
    expect((await returned(row.id)).refundPostedAt).toBeInstanceOf(Date);
    expect((await returned(row.id)).refundAmountMinor).toBe(2000n);
  });

  it('preserves the first amount and entry across a status round-trip', async () => {
    const { caller, returns: [row] } = await fixture();
    await caller.updateStatus({ id: row.id, status: 'refunded', refundAmount: '10' });
    const first = await returned(row.id);
    await caller.updateStatus({ id: row.id, status: 'rejected' });
    expect((await returned(row.id)).refundAmountMinor).toBe(1000n);
    await caller.updateStatus({ id: row.id, status: 'refunded', refundAmount: '999', adminNotes: 'revised' });
    expect(await entries(row.id)).toHaveLength(1);
    expect(await returned(row.id)).toMatchObject({
      refundAmountMinor: 1000n, refundPostedAt: first.refundPostedAt, adminNotes: 'revised', status: 'refunded',
    });
  });

  it('rejects the second partial refund when their sum exceeds the order total', async () => {
    const { caller, returns: [first, second] } = await fixture(2);
    await caller.updateStatus({ id: first.id, status: 'refunded', refundAmount: '15' });
    await expect(caller.updateStatus({ id: second.id, status: 'refunded', refundAmount: '10' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await entries(second.id)).toHaveLength(0);
    expect((await returned(second.id)).refundPostedAt).toBeNull();
  });

  it('serializes concurrent refunds on different returns of the same order', async () => {
    const { caller, returns } = await fixture(2);
    const results = await Promise.allSettled(returns.map(row =>
      caller.updateStatus({ id: row.id, status: 'refunded', refundAmount: '15' }),
    ));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter(result => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: { code: 'BAD_REQUEST' } });
    expect((await Promise.all(returns.map(row => entries(row.id)))).flat()).toHaveLength(1);
  });
});
