import { effectiveAccess } from '@irth/db';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Context } from '@/server/trpc';
import { inventoryRouter } from '@/server/routers/inventory';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const adjustSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int(),
  reason: z.enum(['purchase', 'sale', 'adjustment', 'return', 'damage']),
  notes: z.string().max(500).optional(),
});

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
    access: effectiveAccess({ systemKey: role }),
  } as unknown as Context;
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

/** list fires two queries in Promise.all: rows first, then the tally. */
function queueSelects(results: unknown[]) {
  let i = 0;
  mockDb.select = vi.fn(() => chainOf(results[i++] ?? []));
}

beforeEach(() => {
  mockDb._reset();
});

describe('inventory router — input validation', () => {
  it('adjust: rejects non-uuid productId', () => {
    expect(() => adjustSchema.parse({ productId: 'bad', quantity: 10, reason: 'purchase' })).toThrow();
  });

  it('adjust: rejects invalid reason', () => {
    expect(() => adjustSchema.parse({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 5, reason: 'unknown' })).toThrow();
  });

  it('adjust: allows negative quantity (outbound)', () => {
    const r = adjustSchema.parse({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: -5, reason: 'sale' });
    expect(r.quantity).toBe(-5);
  });

  it('adjust: allows positive quantity (inbound)', () => {
    const r = adjustSchema.parse({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 50, reason: 'purchase' });
    expect(r.quantity).toBe(50);
  });
});

describe('inventory.list', () => {
  const caller = inventoryRouter.createCaller(ctx('owner'));

  it('accepts no input and yields empty rows with zeroed counts', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.list(undefined);
    expect(res.data).toEqual([]);
    expect(res.meta.counts).toEqual({ out: 0, low: 0, ok: 0, all: 0 });
  });

  it('rejects a stock value outside the three states', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    // 'critical' is not a state — the page maps unknown params to undefined, but
    // the router must refuse it rather than silently returning everything.
    await expect(caller.list({ stock: 'critical' } as never)).rejects.toBeDefined();
  });

  it('passes the org-wide tally through untouched while filtered', async () => {
    // Counts must span the whole org, never the active filter — a tab showing
    // its own filtered count would read zero on every other tab.
    queueSelects([
      [{ item: { id: 'i1', quantity: 0, reorderPoint: 5 } }],
      [{ out: 4, low: 7, ok: 91, all: 102 }],
    ]);
    const res = await caller.list({ stock: 'out' });
    expect(res.data).toHaveLength(1);
    expect(res.meta.counts).toEqual({ out: 4, low: 7, ok: 91, all: 102 });
  });

  it('accepts each of the three stock states', async () => {
    for (const stock of ['out', 'low', 'ok'] as const) {
      mockDb.select = vi.fn(() => chainOf([]));
      const res = await caller.list({ stock });
      expect(res.error).toBeNull();
    }
  });
});

describe('inventory out adjustments never go negative', () => {
  const caller = inventoryRouter.createCaller(ctx('owner'));
  const itemId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function updateReturning(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ['set', 'where', 'returning']) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
    mockDb.update = vi.fn(() => chain) as never;
  }

  it('adjust: rejects an out larger than on-hand (guarded update matched no row)', async () => {
    queueSelects([[{ id: itemId, orgId: 'org-1', quantity: 2 }]]);
    updateReturning([]);
    await expect(caller.adjust({ itemId, type: 'out', quantity: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('adjust: applies an out that on-hand covers', async () => {
    queueSelects([[{ id: itemId, orgId: 'org-1', quantity: 5 }]]);
    updateReturning([{ id: itemId, quantity: 3 }]);
    const res = await caller.adjust({ itemId, type: 'out', quantity: 2 });
    expect(res.data.newQuantity).toBe(3);
  });

  it('batchAdjust: rejects the whole batch when one out is short', async () => {
    queueSelects([[{ id: itemId, orgId: 'org-1', quantity: 1 }]]);
    updateReturning([]);
    await expect(
      caller.batchAdjust({ type: 'out', items: [{ itemId, quantity: 3 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('inventory.setLevelDiscrepancyStatus', () => {
  const callerOwner = inventoryRouter.createCaller(ctx('owner'));
  const callerMember = inventoryRouter.createCaller(ctx('member'));
  const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function updateReturning(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ['set', 'where', 'returning']) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
    mockDb.update = vi.fn(() => chain) as never;
  }

  it('rejects mutation from a member role', async () => {
    // Member does not have write permission for inventory.
    await expect(callerMember.setLevelDiscrepancyStatus({ id, status: 'acknowledged' }))
      .rejects.toThrow('Missing permission: inventory.write');
  });

  it('rejects transition from resolved back to open (Zod validation)', async () => {
    await expect(callerOwner.setLevelDiscrepancyStatus({ id, status: 'open' } as never))
      .rejects.toBeDefined();
  });

  it('returns NOT_FOUND if the discrepancy id belongs to another org (update matched no row and select returns nothing)', async () => {
    updateReturning([]); // Update fails
    queueSelects([[]]); // Fallback select returns nothing (not found)
    await expect(callerOwner.setLevelDiscrepancyStatus({ id, status: 'acknowledged' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns BAD_REQUEST if the state transition is invalid (update matched no row but select found it)', async () => {
    updateReturning([]); // Update fails due to status mismatch
    queueSelects([[{ id }]]); // Fallback select finds the row in the org
    await expect(callerOwner.setLevelDiscrepancyStatus({ id, status: 'acknowledged' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('resolves the status and applies resolvedAt/resolvedBy', async () => {
    const now = new Date();
    updateReturning([{ id, status: 'resolved', resolvedAt: now, resolvedBy: 'user-1' }]);
    const res = await callerOwner.setLevelDiscrepancyStatus({ id, status: 'resolved' });
    expect(res.data.status).toBe('resolved');
  });
});

describe('inventory stock changes queue a Shopify push', () => {
  const caller = inventoryRouter.createCaller(ctx('owner'));
  const itemA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const itemB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
  const itemC = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';

  function updateReturning(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ['set', 'where', 'returning']) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
    mockDb.update = vi.fn(() => chain) as never;
  }

  /** Records every inserted row; returns the parsed inventory.push payloads. */
  function capturePushes() {
    const inserted: Array<Record<string, unknown>> = [];
    mockDb.insert = vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        inserted.push(...(Array.isArray(v) ? v : [v]));
      }),
    })) as never;
    return () => inserted
      .filter((row) => row.eventType === 'inventory.push')
      .map((row) => JSON.parse(String(row.payload)));
  }

  it('adjust queues one push for the adjusted item\'s variant', async () => {
    queueSelects([[{ id: itemA, orgId: 'org-1', variantId: 'variant-1', quantity: 5 }]]);
    updateReturning([{ id: itemA, quantity: 8 }]);
    const pushes = capturePushes();

    await caller.adjust({ itemId: itemA, type: 'in', quantity: 3 });

    expect(pushes()).toEqual([{ orgId: 'org-1', variantId: 'variant-1' }]);
  });

  it('adjust queues nothing when the guarded update rejects the change', async () => {
    queueSelects([[{ id: itemA, orgId: 'org-1', variantId: 'variant-1', quantity: 2 }]]);
    updateReturning([]);
    const pushes = capturePushes();

    await expect(caller.adjust({ itemId: itemA, type: 'out', quantity: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(pushes()).toEqual([]);
  });

  it('batchAdjust queues one push per distinct variant, not per stock row', async () => {
    queueSelects([[
      { id: itemA, orgId: 'org-1', variantId: 'variant-1', quantity: 5 },
      { id: itemB, orgId: 'org-1', variantId: 'variant-1', quantity: 2 },
      { id: itemC, orgId: 'org-1', variantId: 'variant-2', quantity: 9 },
    ]]);
    updateReturning([{ id: itemA }]);
    const pushes = capturePushes();

    await caller.batchAdjust({
      type: 'in',
      items: [{ itemId: itemA, quantity: 1 }, { itemId: itemB, quantity: 1 }, { itemId: itemC, quantity: 1 }],
    });

    expect(pushes()).toEqual([
      { orgId: 'org-1', variantId: 'variant-1' },
      { orgId: 'org-1', variantId: 'variant-2' },
    ]);
  });
});