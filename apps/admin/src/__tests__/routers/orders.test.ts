import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Context } from '@/server/trpc';
import { ordersRouter } from '@/server/routers/orders';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

// Input schemas mirrored from orders router — validate without DB
const listInputSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
});

const updateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']),
});

describe('orders router — input validation', () => {
  it('list: defaults page=1 pageSize=20', () => {
    const r = listInputSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });

  it('list: rejects pageSize > 100', () => {
    expect(() => listInputSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('list: accepts valid status filter', () => {
    const r = listInputSchema.parse({ status: 'pending' });
    expect(r.status).toBe('pending');
  });

  it('updateStatus: rejects invalid uuid', () => {
    expect(() => updateStatusSchema.parse({ id: 'not-uuid', status: 'confirmed' })).toThrow();
  });

  it('updateStatus: rejects invalid status', () => {
    expect(() => updateStatusSchema.parse({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'unknown' })).toThrow();
  });

  it('updateStatus: accepts valid input', () => {
    const r = updateStatusSchema.parse({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'delivered' });
    expect(r.status).toBe('delivered');
  });
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
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

/** list fires three queries in Promise.all: rows, total, then the status tally. */
function queueSelects(results: unknown[]) {
  let i = 0;
  mockDb.select = vi.fn(() => chainOf(results[i++] ?? []));
}

beforeEach(() => {
  mockDb._reset();
});

describe('orders.list', () => {
  const caller = ordersRouter.createCaller(ctx('owner'));

  it('yields an empty page with an empty status tally', async () => {
    queueSelects([[], [{ count: 0 }], []]);
    const res = await caller.list({ page: 1, pageSize: 50 });
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
    expect(res.meta.statusCounts).toEqual([]);
  });

  it('reports counts for every status while filtered to one', async () => {
    // The tally is scoped to everything except the status filter. If it shared
    // the filter, each tab would show its own count and zero for the rest,
    // making the strip useless for deciding where to look next.
    queueSelects([
      [{ id: 'o1', status: 'pending' }],
      [{ count: 12 }],
      [
        { status: 'pending', count: 12 },
        { status: 'delivered', count: 40 },
        { status: 'cancelled', count: 3 },
      ],
    ]);
    const res = await caller.list({ page: 1, pageSize: 50, status: 'pending' });
    expect(res.meta.total).toBe(12);
    expect(res.meta.statusCounts).toHaveLength(3);
    expect(res.meta.statusCounts.find((s) => s.status === 'delivered')?.count).toBe(40);
  });

  it('rejects a status outside the schema enum', async () => {
    queueSelects([[], [{ count: 0 }], []]);
    await expect(caller.list({ page: 1, pageSize: 50, status: 'returned' } as never)).rejects.toBeDefined();
  });
});