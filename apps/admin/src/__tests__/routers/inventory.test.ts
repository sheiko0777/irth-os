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