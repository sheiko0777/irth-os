import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { giftCardsRouter } from '@/server/routers/giftCards';
import { mockDb } from '../helpers/mockDb';

const UUID = '11111111-1111-4111-8111-111111111111';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

describe('giftCards router', () => {
  const caller = giftCardsRouter.createCaller(ctx('owner'));

  it('list: empty db yields { data: [], error: null } envelope', async () => {
    const res = await caller.list();
    expect(res).toEqual({ data: [], error: null });
  });

  it('summary: empty db yields all-zero totals', async () => {
    const res = await caller.summary();
    expect(res).toEqual({
      data: { total: 0, active: 0, totalIssued: 0, activeBalance: 0 },
      error: null,
    });
  });

  it('getTransactions: empty db yields { data: [], error: null } envelope', async () => {
    const res = await caller.getTransactions({ giftCardId: UUID });
    expect(res).toEqual({ data: [], error: null });
  });

  it('getTransactions: malformed uuid rejects BAD_REQUEST', async () => {
    await expectCode(caller.getTransactions({ giftCardId: 'nope' }), 'BAD_REQUEST');
  });

  it('topup: missing card rejects NOT_FOUND', async () => {
    await expectCode(caller.topup({ id: UUID, amount: 50 }), 'NOT_FOUND');
  });

  it('topup: malformed uuid rejects BAD_REQUEST', async () => {
    await expectCode(caller.topup({ id: 'not-a-uuid', amount: 50 }), 'BAD_REQUEST');
  });

  it('topup: non-positive amount rejects BAD_REQUEST', async () => {
    await expectCode(caller.topup({ id: UUID, amount: 0 }), 'BAD_REQUEST');
    await expectCode(caller.topup({ id: UUID, amount: -5 }), 'BAD_REQUEST');
  });

  it('cancel: missing card rejects NOT_FOUND', async () => {
    await expectCode(caller.cancel({ id: UUID }), 'NOT_FOUND');
  });

  it('create: non-positive initialAmount rejects BAD_REQUEST', async () => {
    await expectCode(caller.create({ initialAmount: -10 }), 'BAD_REQUEST');
    await expectCode(caller.create({ initialAmount: 0 }), 'BAD_REQUEST');
  });

  it('create: invalid recipientEmail rejects BAD_REQUEST', async () => {
    await expectCode(
      caller.create({ initialAmount: 100, recipientEmail: 'not-an-email' }),
      'BAD_REQUEST'
    );
  });
});
