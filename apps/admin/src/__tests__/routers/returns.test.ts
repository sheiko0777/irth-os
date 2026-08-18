import { EGP, zero } from '@irth/domain';
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock } from '../helpers/mockDb';

const { returnsRouter } = await import('@/server/routers/returns');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
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

  it('restock on a missing return throws "Not found"', async () => {
    await expect(
      caller.restock({ returnId: 'ret-missing', itemId: 'item-1' })
    ).rejects.toThrow('Not found');
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
