import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Context } from '@/server/trpc';
import { mockDb } from '../helpers/mockDb';

const { returnsRouter } = await import('@/server/routers/returns');
const { giftCardsRouter } = await import('@/server/routers/giftCards');

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
