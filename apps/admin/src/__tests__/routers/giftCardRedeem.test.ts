import { effectiveAccess } from '@irth/db/src/permissions';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

vi.mock('@irth/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@irth/db')>(),
  postJournalEntry: vi.fn(),
}));
const { postJournalEntry, ACCOUNT_CODES } = await import('@irth/db');
const { giftCardsRouter } = await import('@/server/routers/giftCards');

const CARD = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';

function ctx(): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role: 'owner',
    access: effectiveAccess({ systemKey: 'owner' }),
  } as unknown as Context;
}

/** Thenable query-builder stub resolving to a caller-supplied value. */
function rows(value: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'for', 'returning', 'values', 'set', 'innerJoin', 'leftJoin']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

const activeCard = { id: CARD, orgId: 'org-1', code: 'ABCD-EFGH-JKLM', currency: 'EGP', balanceMinor: 5000n, status: 'active' };

/** select() results are consumed in call order: the card, then (with an order) the order and prior redemptions. */
function queueSelects(...results: unknown[][]) {
  const select = vi.fn();
  for (const result of results) select.mockReturnValueOnce(rows(result));
  mockDb.select = select as never;
}

function updateReturns(result: unknown[]) {
  mockDb.update = vi.fn(() => rows(result)) as never;
}

beforeEach(() => {
  mockDb._reset();
  vi.mocked(postJournalEntry).mockReset();
});

describe('giftCards.redeem — what a redemption posts', () => {
  const caller = giftCardsRouter.createCaller(ctx());

  it('against a COD order, settles AR-COD and books NO new revenue', async () => {
    queueSelects([activeCard], [{ paymentMethod: 'cod', totalAmountMinor: 10000n, currency: 'EGP' }], [{ total: '0' }]);
    updateReturns([{ id: CARD, balanceMinor: 3000n }]);

    await caller.redeem({ id: CARD, amount: '20', orderId: ORDER, idempotencyKey: 'k1' });

    expect(postJournalEntry).toHaveBeenCalledTimes(1);
    const posting = vi.mocked(postJournalEntry).mock.calls[0][1];
    expect(posting.lines).toEqual([
      { accountCode: ACCOUNT_CODES.GIFT_CARD_LIABILITY, currency: 'EGP', debitMinor: 2000n },
      { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, currency: 'EGP', creditMinor: 2000n },
    ]);
    expect(posting.lines.some((line) => line.accountCode === ACCOUNT_CODES.SALES_REVENUE)).toBe(false);
  });

  it('against an online order, settles AR-Online', async () => {
    queueSelects([activeCard], [{ paymentMethod: 'online', totalAmountMinor: 10000n, currency: 'EGP' }], [{ total: '0' }]);
    updateReturns([{ id: CARD }]);

    await caller.redeem({ id: CARD, amount: '20', orderId: ORDER, idempotencyKey: 'k2' });

    const posting = vi.mocked(postJournalEntry).mock.calls[0][1];
    expect(posting.lines[1]).toEqual({ accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_ONLINE, currency: 'EGP', creditMinor: 2000n });
  });

  it('with no order, still books the spend as revenue (nothing else recognises the sale)', async () => {
    queueSelects([activeCard]);
    updateReturns([{ id: CARD }]);

    await caller.redeem({ id: CARD, amount: '20', idempotencyKey: 'k3' });

    const posting = vi.mocked(postJournalEntry).mock.calls[0][1];
    expect(posting.lines[1]).toEqual({ accountCode: ACCOUNT_CODES.SALES_REVENUE, currency: 'EGP', creditMinor: 2000n });
  });
});

describe('giftCards.redeem — what it refuses', () => {
  const caller = giftCardsRouter.createCaller(ctx());

  it('rejects an order that does not exist in this org, posting nothing', async () => {
    queueSelects([activeCard], []);

    await expect(caller.redeem({ id: CARD, amount: '20', orderId: ORDER, idempotencyKey: 'k4' }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('rejects redemptions that together exceed the order total', async () => {
    // 90.00 already redeemed against a 100.00 order; another 20.00 would be 110.00.
    queueSelects([activeCard], [{ paymentMethod: 'cod', totalAmountMinor: 10000n, currency: 'EGP' }], [{ total: '9000' }]);

    await expect(caller.redeem({ id: CARD, amount: '20', orderId: ORDER, idempotencyKey: 'k5' }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('rejects when the order currency differs from the card currency', async () => {
    queueSelects([activeCard], [{ paymentMethod: 'cod', totalAmountMinor: 10000n, currency: 'USD' }]);

    await expect(caller.redeem({ id: CARD, amount: '20', orderId: ORDER, idempotencyKey: 'k6' }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('rejects an expired or insufficient card (the guarded update matches no row) without posting', async () => {
    queueSelects([activeCard]);
    updateReturns([]);

    await expect(caller.redeem({ id: CARD, amount: '20', idempotencyKey: 'k7' }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
});

describe('giftCards amounts must be positive', () => {
  const caller = giftCardsRouter.createCaller(ctx());

  it('topup rejects a negative amount instead of draining the balance with no ledger entry', async () => {
    queueSelects([activeCard]);

    await expect(caller.topup({ id: CARD, amount: '-5', idempotencyKey: 't1' }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('create rejects a zero opening balance', async () => {
    await expect(caller.create({ initialAmount: '0', currency: 'EGP', idempotencyKey: 'c1' } as never))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST');
    expect(postJournalEntry).not.toHaveBeenCalled();
  });
});
