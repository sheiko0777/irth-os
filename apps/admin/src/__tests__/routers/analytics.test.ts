import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { analyticsRouter } from '@/server/routers/analytics';
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
  // analytics uses db.execute mostly
  (mockDb as any).execute = vi.fn(() => Promise.resolve([]));
});

describe('analytics router', () => {
  const caller = analyticsRouter.createCaller(ctx('owner'));

  it('revenue: out of bounds days rejects BAD_REQUEST', async () => {
    await expectCode(caller.revenue({ days: 1 }), 'BAD_REQUEST');
    await expectCode(caller.revenue({ days: 100 }), 'BAD_REQUEST');
  });

  it('revenue: empty execution yields empty data array', async () => {
    const res = await caller.revenue({ days: 30 });
    expect(res).toEqual({ data: [], error: null, meta: null });
  });

  it('topProducts: out of bounds limit rejects BAD_REQUEST', async () => {
    await expectCode(caller.topProducts({ limit: 1 }), 'BAD_REQUEST');
    await expectCode(caller.topProducts({ limit: 50 }), 'BAD_REQUEST');
  });

  it('topProducts: empty execution yields empty data array', async () => {
    const res = await caller.topProducts({ limit: 10 });
    expect(res).toEqual({ data: [], error: null, meta: null });
  });

  it('inventoryTurnover: empty execution yields empty data and zero count', async () => {
    const res = await caller.inventoryTurnover({ days: 30 });
    expect(res).toEqual({ data: [], lowStockCount: 0, error: null, meta: null });
  });

  it('kpiSummary: yields zeroed summary when empty', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.kpiSummary();
    expect(res).toEqual({
      data: {
        ordersToday: 0,
        revenueToday: 0,
        revenueThisMonth: 0,
        revenueGrowth: null,
        totalOrders: 0,
        lowStockCount: 0,
      },
      error: null,
      meta: null,
    });
  });
});
