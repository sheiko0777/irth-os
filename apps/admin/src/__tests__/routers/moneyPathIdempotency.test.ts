import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

// This file's "no pre-read before the atomic write" tests care about
// ordering around the guarded UPDATE itself, not about campaigns.send's own
// post-guard recipient-snapshot work (which legitimately reads/writes more,
// after the guard has already committed) — stub it out so that unrelated
// concern doesn't leak into the assertion here. Real coverage for
// snapshotAndEnqueueCampaign lives in routers/campaigns.test.ts and
// packages/db's own tests.
vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return { ...actual, snapshotAndEnqueueCampaign: vi.fn() };
});

const { returnsRouter } = await import('@/server/routers/returns');
const { giftCardsRouter } = await import('@/server/routers/giftCards');
const { couponsRouter } = await import('@/server/routers/coupons');
const { campaignsRouter } = await import('@/server/routers/campaigns');
const { customersRouter } = await import('@/server/routers/customers');

function ctx(withOrg: unknown = withOrgMock): Context {
  return {
    db: mockDb,
    withOrg,
    idempotent: idempotentMock,
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
  // F03 moved every linkage/validation check (orderItemId, variantId,
  // inventoryItems) to run BEFORE the atomic claim, so reaching the claim at
  // all now requires all five selects below to resolve — return row,
  // existing item (with a real orderItemId), the linked orderItem (with a
  // variantId and cost basis), the order (for currency), and a matching
  // inventoryItems row. Only once every one of those passes does the
  // conditional UPDATE ... WHERE restock = false RETURNING actually fire.
  function mockResolvedLinkage() {
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => chainOf([{ id: UUID, orgId: 'org-1', orderId: UUID }])) // return row
      .mockImplementationOnce(() => chainOf([{ id: UUID, returnId: UUID, orgId: 'org-1', orderItemId: 'oi-1' }])) // existing item
      .mockImplementationOnce(() => chainOf([{ id: 'oi-1', variantId: 'v-1', costMinor: 0n }])) // linked order item
      .mockImplementationOnce(() => chainOf([{ currency: 'EGP' }])) // order (currency)
      .mockImplementationOnce(() => chainOf([{ id: 'inv-1', variantId: 'v-1', quantity: 5 }])); // inventory item
  }

  it('a second restock of the same item is a no-op (the atomic claim finds nothing to claim)', async () => {
    // The idempotency guard moved INSIDE the transaction (F04): a plain
    // pre-check read before ctx.withOrg was a TOCTOU race between two
    // concurrent restock calls (both could read restock=false before either
    // wrote it). The guard is now a single conditional
    // `UPDATE ... WHERE restock = false RETURNING` — which requires entering
    // the transaction to attempt it at all. Asserting "never re-enters the
    // transaction" (the old invariant here) would now be asserting the very
    // race this fix closes. What must still hold: entering the transaction
    // is harmless when the claim is already taken — no physical or
    // financial effect fires a second time.
    mockResolvedLinkage();
    // The claim's own UPDATE ... RETURNING finds no row: already restocked.
    mockDb.update = vi.fn(() => chainOf([]));
    const withOrgSpy = vi.fn(withOrgMock);

    const res = await returnsRouter.createCaller(ctx(withOrgSpy)).restock({ returnId: UUID, itemId: UUID });

    expect(res.data).toMatchObject({ restocked: false, alreadyRestocked: true });
    expect(withOrgSpy).toHaveBeenCalled();
    // Exactly one UPDATE — the claim attempt itself, and nothing beyond it
    // (no inventory quantity update, no ledger reversal).
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('a first restock does enter the transaction and claims the row', async () => {
    mockResolvedLinkage();
    // The claim's own UPDATE ... RETURNING wins, returning the now-claimed row.
    mockDb.update = vi.fn(() => chainOf([{ id: UUID, returnId: UUID, quantity: 3, orderItemId: 'oi-1', condition: 'good' }]));
    const withOrgSpy = vi.fn(withOrgMock);

    const res = await returnsRouter.createCaller(ctx(withOrgSpy)).restock({ returnId: UUID, itemId: UUID });

    expect(withOrgSpy).toHaveBeenCalled();
    expect(res.data).toMatchObject({ restocked: true, reason: null });
    expect(mockDb.update).toHaveBeenCalledTimes(2); // the claim, then the inventory quantity increment
  });

  it('a validation failure (no linked order item) never reaches the claim', async () => {
    // The exact shape F03 fixed: a missing link must bail out BEFORE the
    // atomic claim, so the row stays retryable instead of getting stuck
    // claimed with nothing to show for it.
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => chainOf([{ id: UUID, orgId: 'org-1', orderId: UUID }]))
      .mockImplementationOnce(() => chainOf([{ id: UUID, returnId: UUID, orgId: 'org-1', orderItemId: null }]));
    mockDb.update = vi.fn(() => chainOf([{ id: UUID }])); // would "win" if reached — must not be
    const withOrgSpy = vi.fn(withOrgMock);

    const res = await returnsRouter.createCaller(ctx(withOrgSpy)).restock({ returnId: UUID, itemId: UUID });

    expect(res.data).toMatchObject({ restocked: false, reason: 'no_order_item_link' });
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('giftCards.topup — decimal safety', () => {
  it('increments the balance in SQL, not by writing back a JS float', async () => {
    // Mirrors the real row: balance is bigint minor units since 0028, and
    // currency is `text NOT NULL DEFAULT 'EGP'`. The fixture previously omitted
    // currency, which the code now reads — a mock that does not match the
    // schema hides exactly the class of bug the integration suite exists for.
    mockDb.select = vi.fn(() =>
      chainOf([{ id: UUID, orgId: 'org-1', balanceMinor: 10n, currency: 'EGP', status: 'active' }]),
    );

    let capturedSet: Record<string, unknown> | undefined;
    const updateChain = chainOf([{ id: UUID }]);
    updateChain.set = vi.fn((v: Record<string, unknown>) => { capturedSet = v; return updateChain; });
    mockDb.update = vi.fn(() => updateChain);
    mockDb.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb));

    await giftCardsRouter.createCaller(ctx()).topup({ id: UUID, amount: 0.2, idempotencyKey: 'topup-decimal' });

    expect(capturedSet).toBeDefined();
    const balance = capturedSet!.balanceMinor;
    // A string or number here means the parseFloat read-modify-write is back
    // (0.1 + 0.2 === 0.30000000000000004, and concurrent top-ups get lost).
    // It must be a drizzle SQL fragment so Postgres does the addition.
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

  it('customers.linkOrder credits in SQL without pre-reading the customer', async () => {
    // Same tell as redeemPoints: mockDb.query is {}, so the old
    // db.query.customers.findFirst pre-read would throw before any write. It
    // also read the balance to compute an absolute new value — two orders
    // linked at once both read the same figure and the second discarded the
    // first. Every counter must now be a SQL fragment.
    let capturedSet: Record<string, unknown> | undefined;
    const updateChain = chainOf([{ id: UUID, loyaltyPoints: 10 }]);
    updateChain.set = vi.fn((v: Record<string, unknown>) => { capturedSet = v; return updateChain; });
    mockDb.update = vi.fn(() => updateChain);
    mockDb.insert = vi.fn(() => chainOf([]));

    const res = await customersRouter.createCaller(ctx()).linkOrder({
      customerId: UUID,
      orderId: UUID,
      orderAmount: 100,
    });

    expect(res.data).toMatchObject({ loyaltyPoints: 10 });
    const sqlName = sql``.constructor.name;
    const points = capturedSet!.loyaltyPoints;
    const orders = capturedSet!.totalOrders;
    const spent = capturedSet!.totalSpentMinor;
    expect(points?.constructor?.name).toBe(sqlName);
    expect(orders?.constructor?.name).toBe(sqlName);
    expect(spent?.constructor?.name).toBe(sqlName);
    // The ledger's balanceAfter must be the value RETURNING gave back, not a
    // total computed here from a stale read.
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('giftCards.topup rejects when the cancelled guard matches nothing', async () => {
    // The card read for its currency still looks active; the guarded UPDATE
    // matches nothing because a cancel landed in between. That must surface as
    // the same BAD_REQUEST the old pre-read raised — never a silent success
    // that credits a written-off card and flips it back to 'active'.
    mockDb.select = vi.fn(() =>
      chainOf([{ id: UUID, orgId: 'org-1', balanceMinor: 10n, currency: 'EGP', status: 'active' }]),
    );
    const insertSpy = vi.fn(() => chainOf([]));
    mockDb.insert = insertSpy;
    mockDb.update = vi.fn(() => chainOf([]));

    await expect(
      giftCardsRouter.createCaller(ctx()).topup({ id: UUID, amount: 50, idempotencyKey: 'topup-cancelled' })
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    // No ledger line for a topup that did not happen.
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
