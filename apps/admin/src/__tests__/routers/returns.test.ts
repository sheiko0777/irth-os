import { EGP, zero } from '@irth/domain';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

vi.mock('@irth/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@irth/db')>(),
  db: mockDb,
  postJournalEntry: vi.fn(),
}));
const { postJournalEntry, inventoryItems, inventoryMovements, ACCOUNT_CODES } = await import('@irth/db');

function rows(value: unknown[]) {
  const chain = mockDb.select();
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

const { returnsRouter } = await import('@/server/routers/returns');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof TRPCError && e.code === code
  );
}

// mockDb.query is {} — resolvers that reach db.query.orderReturns.* throw a
// TypeError under the mock. Assert failure past authorization (not FORBIDDEN).
async function expectRejectsPastAuthz(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => !(e instanceof TRPCError && e.code === 'FORBIDDEN')
  );
}

describe('returns', () => {
  beforeEach(() => mockDb._reset());
  const caller = returnsRouter.createCaller(ctx('owner'));

  it('list rejects an invalid status filter with BAD_REQUEST', async () => {
    // Input parsing runs before the resolver, so this never hits the mock gap.
    await expectCode(caller.list({ status: 'bogus' } as never), 'BAD_REQUEST');
  });

  it('list with valid input rejects past authz (mock: db.query.findMany unavailable)', async () => {
    // list uses db.query.orderReturns.findMany, which the mock cannot serve —
    // with a real db this would resolve to a { data, meta } envelope.
    await expectRejectsPastAuthz(caller.list({}));
  });

  it('get on a missing return rejects past authz (mock: db.query.findFirst unavailable)', async () => {
    // With a real db, get returns { data: null } for a missing id (it does not
    // throw NOT_FOUND); the mock's empty query object throws before that.
    await expectRejectsPastAuthz(caller.get({ id: 'ret-missing' }));
  });

  it('create rejects an invalid reason enum with BAD_REQUEST', async () => {
    await expectCode(
      caller.create({ orderId: 'o-1', reason: 'bogus', items: [] } as never),
      'BAD_REQUEST'
    );
  });

  it('create delegates to the idempotency wrapper', async () => {
    const input = { orderId: '00000000-0000-4000-8000-000000000001', reason: 'other', items: [], idempotencyKey: 'test-key-1' } as const;
    const mockCtx = ctx('owner');
    mockCtx.idempotent = vi.fn().mockResolvedValue({ data: { id: 'ret-1' }, error: null, meta: null });
    const localCaller = returnsRouter.createCaller(mockCtx);

    const res = await localCaller.create(input as never);
    expect(res).toEqual({ data: { id: 'ret-1' }, error: null, meta: null });
    expect(mockCtx.idempotent).toHaveBeenCalledWith(
      'returns.create',
      'test-key-1',
      expect.objectContaining({ idempotencyKey: 'test-key-1' }),
      expect.any(Function)
    );
  });

  it('member is FORBIDDEN on create and updateStatus (admin-gated)', async () => {
    const member = returnsRouter.createCaller(ctx('member'));
    await expectCode(member.create({} as never), 'FORBIDDEN');
    await expectCode(member.updateStatus({} as never), 'FORBIDDEN');
  });

  it('updateStatus on a missing return rejects NOT_FOUND', async () => {
    // Previously this threw a bare `new Error('Not found')` from a SELECT that
    // ran before the UPDATE, which tRPC surfaced as INTERNAL_SERVER_ERROR — a
    // 500 for what is an ordinary client mistake, and this test asserted that
    // wrong behaviour deliberately.
    //
    // The existence check now lives in the UPDATE's own WHERE (no row returned
    // means no such return, in this org), so the case is reported honestly.
    await expectCode(
      caller.updateStatus({ id: 'ret-missing', status: 'approved' }),
      'NOT_FOUND',
    );
  });

  it('updateStatus rejects an invalid status enum with BAD_REQUEST', async () => {
    await expectCode(
      caller.updateStatus({ id: 'ret-1', status: 'shipped' } as never),
      'BAD_REQUEST'
    );
  });

  function refundFixture(posted = false, prior = 0n) {
    const current = { id: 'ret-1', orderId: 'o-1', returnNumber: 'RMA-1',
      refundPostedAt: posted ? new Date() : null, refundAmountMinor: posted ? 1000n : null,
      totalAmountMinor: 2000n, orderCurrency: 'EGP' };
    const target = rows([{ orderId: 'o-1' }]);
    const siblings = rows([current, { id: 'ret-2', refundPostedAt: new Date(), refundAmountMinor: prior }]);
    const claim = rows(posted ? [] : [current]);
    const retry = rows([current]);
    mockDb.select.mockReturnValueOnce(target).mockReturnValueOnce(siblings);
    mockDb.update.mockReturnValueOnce(claim).mockReturnValueOnce(retry);
    return { claim, retry, siblings };
  }

  it('claims the first refund with a durable timestamp and posts once', async () => {
    const { claim, siblings } = refundFixture();
    await caller.updateStatus({ id: 'ret-1', status: 'refunded', refundAmount: '10' });
    expect(claim.set).toHaveBeenCalledWith(expect.objectContaining({
      refundAmountMinor: 1000n, refundPostedAt: expect.any(Object),
    }));
    expect(siblings.for).toHaveBeenCalledWith('update', expect.any(Object));
    expect(postJournalEntry).toHaveBeenCalledTimes(1);
  });

  it('preserves the posted amount on a retry even when the new amount exceeds the bound', async () => {
    const { retry } = refundFixture(true);
    await caller.updateStatus({ id: 'ret-1', status: 'refunded', refundAmount: '999', adminNotes: 'updated' });
    expect(retry.set).toHaveBeenCalledWith({ status: 'refunded', adminNotes: 'updated', resolvedAt: expect.any(Date) });
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('rejects cumulative refunds above the order total before claiming', async () => {
    refundFixture(false, 1500n);
    await expectCode(caller.updateStatus({ id: 'ret-1', status: 'refunded', refundAmount: '10' }), 'BAD_REQUEST');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it.each(['0', '-1'])('rejects a nonpositive first refund (%s) without claiming', async (refundAmount) => {
    refundFixture();
    await expectCode(caller.updateStatus({ id: 'ret-1', status: 'refunded', refundAmount }), 'BAD_REQUEST');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'refunded'] as const)('keeps the amount intact on a plain %s update', async (status) => {
    const update = rows([{ id: 'ret-1', refundAmountMinor: 1000n }]);
    mockDb.update.mockReturnValueOnce(update);
    await caller.updateStatus({ id: 'ret-1', status });
    expect(update.set).toHaveBeenCalledWith({ status, adminNotes: undefined, resolvedAt: expect.any(Date) });
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('restock on a missing return throws "Not found"', async () => {
    await expect(
      caller.restock({ returnId: 'ret-missing', itemId: 'item-1' })
    ).rejects.toThrow('Not found');
  });

  it('create rejects a line outside the requested order before inserting', async () => {
    await expectCode(caller.create({
      orderId: 'o-1', reason: 'other',
      items: [{ orderItemId: '00000000-0000-4000-8000-000000000001', quantity: 1 }],
    }), 'BAD_REQUEST');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it.each([1, 2])('create bounds prior returns plus duplicate request lines (%s)', async (copies) => {
    const line = rows([{ quantity: 2, productName: 'Widget', variantName: 'Default', unitPriceMinor: 100n }]);
    const prior = rows([{ quantity: copies === 1 ? '2' : '1' }]);
    mockDb.select.mockReturnValueOnce(line).mockReturnValueOnce(prior);
    await expectCode(caller.create({
      orderId: 'o-1', reason: 'other',
      items: Array.from({ length: copies }, () => ({
        orderItemId: '00000000-0000-4000-8000-000000000001', quantity: 1,
      })),
    }), 'BAD_REQUEST');
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(line.for).toHaveBeenCalledWith('update', expect.any(Object));
  });

  function restockFixture(condition: string, costMinor: bigint | null, claimed = true) {
    const item = { id: 'item-1', returnId: 'ret-1', orderItemId: 'line-1', quantity: 2, condition };
    const selections = [
      rows([{ id: 'ret-1', orderId: 'o-1', returnNumber: 'RMA-1' }]),
      rows([item]), rows([{ variantId: 'v-1', costMinor }]), rows([{ currency: 'EGP' }]), rows([{ id: 'inv-1' }]),
    ];
    const claim = rows(claimed ? [item] : []);
    for (const selection of selections) mockDb.select.mockReturnValueOnce(selection);
    mockDb.update.mockReturnValueOnce(claim);
  }

  it.each(['no_inventory_item', 'no_variant', 'no_order_item_link'] as const)(
    'does not claim or post any effects on %s', async (reason) => {
      const item = { id: 'item-1', restock: false,
        orderItemId: reason === 'no_order_item_link' ? null : 'line-1' };
      const selections = [
        rows([{ id: 'ret-1', orderId: 'o-1' }]), rows([item]),
        rows([{ variantId: reason === 'no_variant' ? null : 'v-1', costMinor: 300n }]),
        rows([{ currency: 'EGP' }]), rows([]),
      ];
      for (const selection of selections) mockDb.select.mockReturnValueOnce(selection);
      expect((await caller.restock({ returnId: 'ret-1', itemId: 'item-1' })).data)
        .toEqual({ restocked: false, reason });
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(postJournalEntry).not.toHaveBeenCalled();
    },
  );

  it.each(['new', 'good'])('increments %s saleable stock and reverses known cost', async (condition) => {
    restockFixture(condition, 300n);
    expect((await caller.restock({ returnId: 'ret-1', itemId: 'item-1' })).data.restocked).toBe(true);
    expect(mockDb.update).toHaveBeenCalledWith(inventoryItems);
    expect(postJournalEntry).toHaveBeenCalledTimes(1);
    expect(postJournalEntry).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      lines: [
        { accountCode: ACCOUNT_CODES.INVENTORY, currency: 'EGP', debitMinor: 600n },
        { accountCode: ACCOUNT_CODES.COGS, currency: 'EGP', creditMinor: 600n },
      ],
    }));
    const movement = mockDb.insert.mock.results[0].value;
    expect(movement.values).toHaveBeenCalledWith(expect.objectContaining({ type: 'in', quantity: 2 }));
  });

  it.each(['damaged', 'unknown'])('holds %s stock out of saleable inventory but reverses cost', async (condition) => {
    restockFixture(condition, 300n);
    const result = await caller.restock({ returnId: 'ret-1', itemId: 'item-1' });
    expect(result.data.restocked).toBe(true);
    expect(mockDb.update).not.toHaveBeenCalledWith(inventoryItems);
    expect(postJournalEntry).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      sourceTable: 'return_items', sourceId: 'item-1',
      lines: [
        { accountCode: ACCOUNT_CODES.INVENTORY, currency: 'EGP', debitMinor: 600n },
        { accountCode: ACCOUNT_CODES.COGS, currency: 'EGP', creditMinor: 600n },
      ],
    }));
    expect(mockDb.insert).toHaveBeenCalledWith(inventoryMovements);
    const movement = mockDb.insert.mock.results[0].value;
    expect(movement.values).toHaveBeenCalledWith(expect.objectContaining({
      type: 'adjustment', quantity: 2, note: expect.stringContaining('held out of saleable stock'),
    }));
  });

  it('restocks physically with null cost without inventing a reversal', async () => {
    restockFixture('good', null);
    expect((await caller.restock({ returnId: 'ret-1', itemId: 'item-1' })).data.restocked).toBe(true);
    expect(mockDb.update).toHaveBeenCalledWith(inventoryItems);
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('does nothing when the conditional claim loses', async () => {
    restockFixture('good', 300n, false);
    expect((await caller.restock({ returnId: 'ret-1', itemId: 'item-1' })).data)
      .toEqual({ restocked: false, alreadyRestocked: true });
    expect(mockDb.update).not.toHaveBeenCalledWith(inventoryItems);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  it('summary resolves with zeroed counters on an empty db', async () => {
    const res = await caller.summary();
    expect(res.data.total).toBe(0);
    expect(res.data.pendingRefundAmount).toEqual(zero(EGP));
    expect(res.data.byStatus).toEqual({
      requested: 0,
      approved: 0,
      rejected: 0,
      received: 0,
      restocked: 0,
      refunded: 0,
      exchanged: 0,
    });
    expect(res.error).toBeNull();
  });
});
