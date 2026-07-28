import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { notificationsRouter } from '@/server/routers/notifications';
import { mockDb } from '../helpers/mockDb';

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

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

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'returning', 'values', 'set', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

beforeEach(() => {
  mockDb._reset();
});

describe('notifications router', () => {
  const caller = notificationsRouter.createCaller(ctx('owner'));

  it('list: empty db yields empty items and zeros', async () => {
    // 1st query is items, 2nd is counts
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => chainOf([]))
      .mockImplementationOnce(() => chainOf([{ total: 0, unread: 0 }]));
      
    const res = await caller.list({ page: 1, pageSize: 20 });
    expect(res).toEqual({ data: { items: [], total: 0, unread: 0 }, error: null, meta: null });
  });

  it('list: out of bounds pagination rejects BAD_REQUEST', async () => {
    await expectCode(caller.list({ page: 0 }), 'BAD_REQUEST');
    await expectCode(caller.list({ pageSize: 100 }), 'BAD_REQUEST');
  });

  it('markRead: malformed id rejects BAD_REQUEST', async () => {
    await expectCode(caller.markRead({ id: 'bad-uuid' }), 'BAD_REQUEST');
  });

  it('markRead: yields ok: true', async () => {
    mockDb.update = vi.fn(() => chainOf([{ id: UUID }]));
    const res = await caller.markRead({ id: UUID });
    expect(res).toEqual({ data: { ok: true }, error: null, meta: null });
  });

  it('markAllRead: yields ok: true', async () => {
    mockDb.update = vi.fn(() => chainOf([{ id: UUID }]));
    const res = await caller.markAllRead();
    expect(res).toEqual({ data: { ok: true }, error: null, meta: null });
  });

  it('unreadCount: yields zero for empty db', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.unreadCount();
    expect(res).toEqual({ data: { count: 0 }, error: null, meta: null });
  });
});
