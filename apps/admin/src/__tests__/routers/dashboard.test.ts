import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@/server/trpc';
import { dashboardRouter } from '@/server/routers/dashboard';
import { mockDb } from '../helpers/mockDb';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
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

describe('dashboard router', () => {
  const caller = dashboardRouter.createCaller(ctx('owner'));

  it('getStats: yields zeroed stats when db is empty', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.getStats();
    expect(res).toEqual({
      data: {
        ordersToday: 0,
        revenueToday: 0,
        pendingOrders: 0,
        activeProducts: 0,
      },
      error: null,
      meta: null,
    });
  });

  it('getRecentOrders: yields empty array when db is empty', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.getRecentOrders();
    expect(res).toEqual({ data: [], error: null, meta: null });
  });
});
