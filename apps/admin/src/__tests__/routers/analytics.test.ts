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

  /**
   * The mock's execute() returned [] without looking at what it was handed, so
   * the suite stayed green while every analytics query threw in production:
   * db.execute with a raw sql`` template does not convert Date params, and
   * postgres-js rejects the object outright. This walks the bound params and
   * fails on any Date, which is the shape that broke.
   */
  function rawDateParams(sqlObj: unknown): Date[] {
    const chunks = (sqlObj as { queryChunks?: unknown[] })?.queryChunks ?? [];
    const found: Date[] = [];
    for (const c of chunks) {
      // An interpolated Date sits in queryChunks as a bare Date. Note it is NOT
      // wrapped in anything with a .value — StringChunk is what has `.value`,
      // and filtering on that key finds only SQL text. The first version of
      // this guard did exactly that and passed against the broken code.
      if (c instanceof Date) found.push(c);
      else if (
        c && typeof c === 'object' && 'value' in c &&
        (c as { value: unknown }).value instanceof Date
      ) {
        found.push((c as { value: Date }).value);
      }
    }
    return found;
  }

  it('revenue: binds no raw Date params', async () => {
    await caller.revenue({ days: 30 });
    const arg = (mockDb as unknown as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls[0][0];
    const dates = rawDateParams(arg);
    expect(dates).toEqual([]);
  });

  it('inventoryTurnover: binds no raw Date params', async () => {
    await caller.inventoryTurnover({ days: 30 });
    const arg = (mockDb as unknown as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls[0][0];
    const dates = rawDateParams(arg);
    expect(dates).toEqual([]);
  });

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
