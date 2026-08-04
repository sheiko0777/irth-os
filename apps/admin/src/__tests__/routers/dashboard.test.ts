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

/**
 * getStats fires eight queries inside one Promise.all; the array expressions
 * evaluate in order, so handing back results in that same order lets a test
 * drive each branch independently.
 */
function queueSelects(results: unknown[]) {
  let i = 0;
  mockDb.select = vi.fn(() => chainOf(results[i++] ?? []));
}

/** The UTC day key for `offset` days from today, matching the router's bucketing. */
function utcDayKey(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
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
        // No prior-day basis, so a percentage would divide by zero. Null says
        // "no comparison"; 0 would falsely claim the metric held flat.
        deltas: { ordersToday: null, revenueToday: null },
        series: { orders: [0, 0, 0, 0, 0, 0, 0], revenue: [0, 0, 0, 0, 0, 0, 0] },
        pipeline: [],
      },
      error: null,
      meta: null,
    });
  });

  it('getStats: pads the sparkline to seven points when days have no orders', async () => {
    queueSelects([
      [{ count: 5 }],                       // ordersToday
      [{ total: '900' }],                   // revenueToday
      [{ count: 2 }],                       // pendingOrders
      [{ count: 40 }],                      // activeProducts
      [{ count: 4 }],                       // ordersYesterday
      [{ total: '600' }],                   // revenueYesterday
      [                                     // daily orders — only two of seven days traded
        { day: utcDayKey(-6), orderCount: 3 },
        { day: utcDayKey(0), orderCount: 5 },
      ],
      [                                     // daily revenue — delivered only
        { day: utcDayKey(-6), revenue: '300' },
        { day: utcDayKey(0), revenue: '900' },
      ],
      [{ status: 'pending', count: 2 }],    // pipeline
    ]);

    const res = await caller.getStats();

    // Gaps must become zeros, not vanish — a sparkline that silently drops quiet
    // days compresses the x-axis and misreports the shape of the trend.
    expect(res.data.series.orders).toEqual([3, 0, 0, 0, 0, 0, 5]);
    expect(res.data.series.revenue).toEqual([300, 0, 0, 0, 0, 0, 900]);
  });

  it('getStats: computes day-over-day deltas against the prior window', async () => {
    queueSelects([
      [{ count: 5 }],
      [{ total: '900' }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 4 }],      // 4 -> 5 is +25%
      [{ total: '600' }],  // 600 -> 900 is +50%
      [],
      [],
      [],
    ]);

    const res = await caller.getStats();
    expect(res.data.deltas.ordersToday).toBeCloseTo(25);
    expect(res.data.deltas.revenueToday).toBeCloseTo(50);
  });

  it('getStats: reports a fall as a negative delta', async () => {
    queueSelects([
      [{ count: 3 }],
      [{ total: '250' }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 6 }],      // 6 -> 3 is -50%
      [{ total: '500' }],  // 500 -> 250 is -50%
      [],
      [],
      [],
    ]);

    const res = await caller.getStats();
    expect(res.data.deltas.ordersToday).toBeCloseTo(-50);
    expect(res.data.deltas.revenueToday).toBeCloseTo(-50);
  });

  it('getAlerts: yields zeroed counts when db is empty', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.getAlerts();
    expect(res).toEqual({
      data: { lateOrders: 0, outOfStock: 0, pendingReturns: 0 },
      error: null,
      meta: null,
    });
  });

  it('getAlerts: surfaces each count independently', async () => {
    // Three queries fire in Promise.all order: late orders, out of stock,
    // pending returns. Distinct values prove none of them are cross-wired.
    queueSelects([[{ count: 7 }], [{ count: 4 }], [{ count: 12 }]]);
    const res = await caller.getAlerts();
    expect(res.data).toEqual({ lateOrders: 7, outOfStock: 4, pendingReturns: 12 });
  });

  it('getRecentOrders: yields empty array when db is empty', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.getRecentOrders();
    expect(res).toEqual({ data: [], error: null, meta: null });
  });
});