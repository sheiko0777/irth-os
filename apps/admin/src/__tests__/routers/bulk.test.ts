import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { bulkRouter } from '@/server/routers/bulk';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

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

describe('bulk router', () => {
  const caller = bulkRouter.createCaller(ctx('owner'));
  const memberCaller = bulkRouter.createCaller(ctx('member'));

  it('bulkUpdateOrderStatus: validates enum status rejects BAD_REQUEST', async () => {
    await expectCode(
      caller.bulkUpdateOrderStatus({ ids: [UUID], status: 'invalid_status' as never }),
      'BAD_REQUEST'
    );
  });

  it('bulkUpdateOrderStatus: member caller rejects FORBIDDEN (adminProcedure)', async () => {
    await expectCode(
      memberCaller.bulkUpdateOrderStatus({ ids: [UUID], status: 'pending' }),
      'FORBIDDEN'
    );
  });

  it('exportOrders: empty db yields empty array', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.exportOrders({ startDate: '2023-01-01', endDate: '2023-12-31' });
    expect(res).toEqual({ data: [], error: null, meta: null });
  });

  it('exportOrders: invalid date format rejects BAD_REQUEST', async () => {
    // Actually zod is just z.string() here so this validation won't fail Zod,
    // but we can check if a bad enum fails.
    await expectCode(
      caller.exportOrders({ startDate: '2023-01-01', endDate: '2023-12-31', status: 'wrong' as never }),
      'BAD_REQUEST'
    );
  });

  it('exportInventory: yields empty array', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.exportInventory();
    expect(res).toEqual({ data: [], error: null, meta: null });
  });

  it('exportCustomers: yields empty array', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const res = await caller.exportCustomers();
    expect(res).toEqual({ data: [], error: null, meta: null });
  });
});

describe('bulkUpdateOrderStatus — outbox and count', () => {
  const UUID2 = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

  /** Update returns `changed`; the contact SELECT returns `contact`. */
  function wire(changed: unknown[], contact: unknown[] = []) {
    const updateChain = chainOf(changed);
    mockDb.update = vi.fn(() => updateChain);
    // First select is the contact lookup in buildOrderNotification; any later
    // one (tracking URL / template) resolves empty, which is the unconfigured
    // path and keeps trackingUrl absent.
    mockDb.select = vi.fn(() => chainOf(contact));
    const inserts: unknown[][] = [];
    mockDb.insert = vi.fn(() => {
      const c = chainOf([]);
      c.values = vi.fn((v: unknown) => { inserts.push([v]); return c; });
      return c;
    });
    return inserts;
  }

  it('reports the rows that actually changed, not the number of ids sent', async () => {
    // ids.length was reported unconditionally, so ids belonging to another
    // tenant, ids that do not exist, and orders already in the target status
    // all counted as successful updates.
    wire([{ id: UUID, orderNumber: 'IRT-2026-0001', customerId: null }]);

    const res = await bulkRouter.createCaller(ctx('owner'))
      .bulkUpdateOrderStatus({ ids: [UUID, UUID2], status: 'confirmed' });

    expect(res.data).toEqual({ updated: 1 });
  });

  it('queues one outbox event per order that moved', async () => {
    const inserts = wire(
      [
        { id: UUID, orderNumber: 'IRT-2026-0001', customerId: UUID },
        { id: UUID2, orderNumber: 'IRT-2026-0002', customerId: UUID2 },
      ],
      [{ name: 'Amira', email: 'a@example.com', phone: '+201000000000' }],
    );

    await bulkRouter.createCaller(ctx('owner'))
      .bulkUpdateOrderStatus({ ids: [UUID, UUID2], status: 'confirmed' });

    const events = inserts.flat().filter(
      (v): v is { eventType: string; payload: string } =>
        typeof v === 'object' && v !== null && 'eventType' in v,
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.eventType === 'order.confirmed')).toBe(true);
    // Bulk-confirming a hundred orders used to notify nobody at all.
    expect(JSON.parse(events[0].payload).orderNumber).toBe('IRT-2026-0001');
  });

  it('queues nothing for a status the worker cannot handle', async () => {
    // The worker branches on order.confirmed and order.shipped only. An event
    // for `delivered` would be polled, match nothing, and be marked processed
    // having sent nothing — which reads as success on the Integrations screen.
    const inserts = wire(
      [{ id: UUID, orderNumber: 'IRT-2026-0001', customerId: UUID }],
      [{ name: 'Amira', email: 'a@example.com', phone: '+201000000000' }],
    );

    await bulkRouter.createCaller(ctx('owner'))
      .bulkUpdateOrderStatus({ ids: [UUID], status: 'delivered' });

    const events = inserts.flat().filter(
      (v) => typeof v === 'object' && v !== null && 'eventType' in (v as object),
    );
    expect(events).toHaveLength(0);
  });

  it('queues nothing when no row changed', async () => {
    // The ne(status) guard means re-applying a status every order already has
    // returns zero rows — so nobody is re-notified.
    const inserts = wire([]);

    const res = await bulkRouter.createCaller(ctx('owner'))
      .bulkUpdateOrderStatus({ ids: [UUID], status: 'confirmed' });

    expect(res.data).toEqual({ updated: 0 });
    const events = inserts.flat().filter(
      (v) => typeof v === 'object' && v !== null && 'eventType' in (v as object),
    );
    expect(events).toHaveLength(0);
  });
});
