import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock } from '../helpers/mockDb';

const { etaRouter } = await import('@/server/routers/eta');

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

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

beforeEach(() => {
  mockDb._reset();
});

describe('eta', () => {
  it('list resolves with the data envelope', async () => {
    const res = await etaRouter.createCaller(ctx()).list({});
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('submit rejects a malformed orderId with BAD_REQUEST', async () => {
    await expectCode(etaRouter.createCaller(ctx()).submit({ orderId: 'nope' } as never), 'BAD_REQUEST');
  });

  it('submit returns an error result when the order does not exist', async () => {
    // Order lookup resolves empty; the router reports rather than throws.
    const res = await etaRouter.createCaller(ctx()).submit({ orderId: UUID });
    expect(res.data).toBeNull();
    expect(res.error).toBe('Order not found');
  });

  it('submit does NOT re-issue an invoice that is already submitted', async () => {
    // This is the idempotency guard: an already-submitted invoice must return
    // early, before the ETA service call. Re-issuing files a duplicate tax
    // invoice with the government — not something a retry may cause.
    const submitted = { id: UUID, orderId: UUID, orgId: 'org-1', status: 'submitted' };
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => chainOf([{ id: UUID, orgId: 'org-1', totalAmount: '100.00' }]))
      .mockImplementationOnce(() => chainOf([submitted]));
    const insertSpy = vi.fn(() => chainOf([]));
    mockDb.insert = insertSpy;

    const res = await etaRouter.createCaller(ctx()).submit({ orderId: UUID });

    expect(res.data).toMatchObject({ status: 'submitted' });
    expect(res.error).toBeNull();
    // Returning early means nothing was written on this path.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('checkStatus rejects a malformed id with BAD_REQUEST', async () => {
    await expectCode(etaRouter.createCaller(ctx()).checkStatus({ orderId: 'nope' } as never), 'BAD_REQUEST');
  });

  it('cancel requires a reason', async () => {
    await expectCode(etaRouter.createCaller(ctx()).cancel({ orderId: UUID } as never), 'BAD_REQUEST');
  });

  it('a member cannot submit, check, cancel or bulk-submit', async () => {
    const member = etaRouter.createCaller(ctx('member'));
    const forbidden = (e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN';
    await expect(member.submit({ orderId: UUID })).rejects.toSatisfy(forbidden);
    await expect(member.checkStatus({ orderId: UUID })).rejects.toSatisfy(forbidden);
    await expect(member.cancel({ orderId: UUID, reason: 'x' })).rejects.toSatisfy(forbidden);
    await expect(member.submitPending()).rejects.toSatisfy(forbidden);
  });

  it('a member can still read the invoice list', async () => {
    const res = await etaRouter.createCaller(ctx('member')).list({});
    expect(Array.isArray(res.data)).toBe(true);
  });
});
