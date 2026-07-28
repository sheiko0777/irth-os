import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb } from '../helpers/mockDb';

const { returnsRouter } = await import('@/server/routers/returns');
const { giftCardsRouter } = await import('@/server/routers/giftCards');
const { couponsRouter } = await import('@/server/routers/coupons');
const { campaignsRouter } = await import('@/server/routers/campaigns');
const { customersRouter } = await import('@/server/routers/customers');

function ctx(): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role: 'owner',
  } as unknown as Context;
}

/** Thenable query-builder stub resolving to a caller-supplied value. */
function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'returning', 'values', 'set', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

beforeEach(() => {
  mockDb._reset();
});

describe('returns.restock — idempotency', () => {
  it('a second restock of the same item is a no-op (never re-enters the transaction)', async () => {
    // 1st select -> the return row; 2nd select -> a line already restocked.
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => chainOf([{ id: UUID, orgId: 'org-1' }]))
      .mockImplementationOnce(() => chainOf([{ id: UUID, returnId: UUID, quantity: 3, restock: true, orderItemId: UUID }]));
    const txSpy = vi.fn();
    mockDb.transaction = txSpy;

    const res = await returnsRouter.createCaller(ctx()).restock({ returnId: UUID, itemId: UUID });

    expect(res.data).toMatchObject({ restocked: false, alreadyRestocked: true });
    // The guard must short-circuit before any write — this is the whole fix.
    expect(txSpy).not.toHaveBeenCalled();
  });

  it('a first restock does enter the transaction', async () => {
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => chainOf([{ id: UUID, orgId: 'org-1' }]))
      .mockImplementationOnce(() => chainOf([{ id: UUID, returnId: UUID, quantity: 3, restock: false, orderItemId: null }]));
    const txSpy = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    mockDb.transaction = txSpy;

    const res = await returnsRouter.createCaller(ctx()).restock({ returnId: UUID, itemId: UUID });

    expect(txSpy).toHaveBeenCalled();
    // No orderItemId -> nothing to credit, but the line is still flagged.
    expect(res.data).toMatchObject({ restocked: false, reason: 'no_order_item_link' });
  });
});

describe('giftCards.topup — decimal safety', () => {
  it('increments the balance in SQL, not by writing back a JS float', async () => {
    mockDb.select = vi.fn(() => chainOf([{ id: UUID, orgId: 'org-1', balance: '0.10', status: 'active' }]));

    let capturedSet: Record<string, unknown> | undefined;
    const updateChain = chainOf([{ id: UUID }]);
    updateChain.set = vi.fn((v: Record<string, unknown>) => { capturedSet = v; return updateChain; });
    mockDb.update = vi.fn(() => updateChain);
    mockDb.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb));

    await giftCardsRouter.createCaller(ctx()).topup({ id: UUID, amount: 0.2 });

    expect(capturedSet).toBeDefined();
    const balance = capturedSet!.balance;
    // A string or number here means the parseFloat read-modify-write is back
    // (0.1 + 0.2 === 0.30000000000000004, and concurrent top-ups get lost).
    // It must be a drizzle SQL fragment so Postgres does the decimal math.
    expect(typeof balance).not.toBe('string');
    expect(typeof balance).not.toBe('number');
    expect(balance?.constructor?.name).toBe(sql``.constructor.name);
  });
});

// The shared regression these three guard: the eligibility check must live in
// the UPDATE's WHERE clause, not in a SELECT that runs first. A pre-read on the
// success path is the signature of the check-then-update pattern coming back —
// which is what lets two concurrent calls both pass the same check.
describe('atomic guards — no read-before-write on the success path', () => {
  it('coupons.redeem updates under guard without pre-reading the coupon', async () => {
    const selectSpy = vi.fn(() => chainOf([]));
    mockDb.select = selectSpy;
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, usedCount: 1 }]));

    await couponsRouter.createCaller(ctx()).redeem({ couponId: UUID });

    expect(mockDb.update).toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('coupons.redeem rejects instead of silently succeeding when the guard matches nothing', async () => {
    // Update matches no row (inactive / expired / maxUses reached), then the
    // follow-up select finds the coupon exists -> must be BAD_REQUEST.
    mockDb.update = vi.fn(() => chainOf([]));
    mockDb.select = vi.fn(() => chainOf([{ id: UUID }]));

    await expect(
      couponsRouter.createCaller(ctx()).redeem({ couponId: UUID })
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
  });

  it('campaigns.send transitions under guard without pre-reading the campaign', async () => {
    const selectSpy = vi.fn(() => chainOf([]));
    mockDb.select = selectSpy;
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, status: 'sending' }]));

    await campaignsRouter.createCaller(ctx()).send({ id: UUID });

    expect(mockDb.update).toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('customers.redeemPoints decrements under guard without pre-reading the balance', async () => {
    // mockDb.query is {}, so any pre-read via db.query.customers.findFirst would
    // throw — reaching the ledger insert proves the balance check moved into SQL.
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, loyaltyPoints: 50 }]));
    mockDb.insert = vi.fn(() => chainOf([]));
    mockDb.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb));

    const res = await customersRouter.createCaller(ctx()).redeemPoints({ id: UUID, points: 50 });

    expect(res.data).toMatchObject({ loyaltyPoints: 50 });
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
