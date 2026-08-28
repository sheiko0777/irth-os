import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { getTableName } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { outboxEvents } from '@irth/db';
import type { Context } from '@/server/trpc';
import { ordersRouter } from '@/server/routers/orders';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

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
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'groupBy', 'update', 'set', 'insert', 'values', 'returning']) {
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

/**
 * updateStatus is the only producer of customer notifications in this router.
 *
 * The table and its worker (apps/api/src/workers/outboxWorker.ts) both shipped
 * long ago and nothing ever wrote a row, so the worker never fired and no
 * customer notification was ever sent. These tests pin the two halves of the
 * contract that made that invisible: that a row IS written, and that its
 * payload is the shape the worker parses — a producer emitting something the
 * worker cannot read is worse than none, because the row retries five times and
 * then sits failed forever.
 */
const ORDER_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CUSTOMER_UUID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const CONTACT = { name: 'سارة', email: 'sara@example.com', phone: '+201000000000' };

/** Stands in for `ctx.db.query.orders.findFirst`, which the shared mock leaves empty. */
function stubOrder(order: Record<string, unknown> | undefined) {
  (mockDb as unknown as { query: Record<string, unknown> }).query = {
    orders: { findFirst: vi.fn(async () => order) },
  };
}

/**
 * The mock declares `insert: vi.fn(() => chainable())` — no parameters — so
 * vitest types each recorded call as the empty tuple. The table argument is
 * genuinely there at runtime; only its type is missing.
 */
function insertCalls(): unknown[][] {
  return mockDb.insert.mock.calls as unknown as unknown[][];
}

function isOutbox(call: unknown[]): boolean {
  return getTableName(call[0] as Parameters<typeof getTableName>[0]) === getTableName(outboxEvents);
}

/** Every row handed to `tx.insert(outboxEvents).values(...)` during the call. */
function outboxRows(): { eventType: string; payload: string }[] {
  const rows: { eventType: string; payload: string }[] = [];
  insertCalls().forEach((call, i) => {
    if (!isOutbox(call)) return;
    const chain = mockDb.insert.mock.results[i].value as { values: { mock: { calls: unknown[][] } } };
    for (const [row] of chain.values.mock.calls) {
      rows.push(row as { eventType: string; payload: string });
    }
  });
  return rows;
}

/** The single emitted event, parsed the way the worker parses it. */
function onlyEvent() {
  const rows = outboxRows();
  expect(rows).toHaveLength(1);
  return { eventType: rows[0].eventType, payload: JSON.parse(rows[0].payload) as Record<string, unknown> };
}

describe('orders.updateStatus — outbox producer', () => {
  const caller = ordersRouter.createCaller(ctx('owner'));

  it('confirming an order queues order.confirmed with the shape the worker reads', async () => {
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0001', status: 'pending', customerId: CUSTOMER_UUID });
    queueSelects([[CONTACT]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' });

    const { eventType, payload } = onlyEvent();
    expect(eventType).toBe('order.confirmed');
    // Exactly the fields outboxWorker's order.confirmed branch reads: phone for
    // the WhatsApp template, email for the transactional mail, name and number
    // for both bodies.
    expect(payload).toEqual({
      orderNumber: 'IRT-2026-0001',
      customerName: 'سارة',
      customerPhone: '+201000000000',
      customerEmail: 'sara@example.com',
    });
  });

  it('shipping renders the waybill into the org tracking template', async () => {
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0002', status: 'confirmed', customerId: CUSTOMER_UUID });
    // customers, then the latest shipment_tracking row, then the org setting.
    queueSelects([
      [CONTACT],
      [{ trackingNumber: 'BST-4471' }],
      [{ value: 'https://track.example/s?id={tracking}' }],
    ]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'shipped' });

    const { eventType, payload } = onlyEvent();
    expect(eventType).toBe('order.shipped');
    expect(payload.trackingUrl).toBe('https://track.example/s?id=BST-4471');
  });

  it('omits trackingUrl rather than guessing one when no template is configured', async () => {
    // The worker does `payload.trackingUrl || ''`, so an absent key degrades to
    // a blank template slot. A wrong URL would be pasted into a real customer's
    // WhatsApp message, which is strictly worse than a blank one.
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0003', status: 'confirmed', customerId: CUSTOMER_UUID });
    queueSelects([[CONTACT], [{ trackingNumber: 'BST-4471' }], []]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'shipped' });

    expect(onlyEvent().payload).not.toHaveProperty('trackingUrl');
  });

  it('does not re-notify when the status is saved again unchanged', async () => {
    // The UPDATE has no ne(status) guard, so a re-save returns a row happily.
    // Without the transition check every click would re-send the confirmation.
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0004', status: 'confirmed', customerId: CUSTOMER_UUID });
    queueSelects([[CONTACT]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' });

    expect(outboxRows()).toEqual([]);
  });

  it('writes nothing for a status the worker has no branch for', async () => {
    // 'delivered' would be polled, match neither branch, and be marked
    // processed having sent nothing — indistinguishable from a real send.
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0005', status: 'shipped', customerId: CUSTOMER_UUID });
    queueSelects([[CONTACT]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'delivered' });

    expect(outboxRows()).toEqual([]);
  });

  it('writes nothing when the order has no customer record to reach', async () => {
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0006', status: 'pending', customerId: null });
    queueSelects([[]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' });

    expect(outboxRows()).toEqual([]);
  });

  it('writes nothing for order.shipped when the customer has no phone', async () => {
    // order.shipped has only a WhatsApp branch — no email fallback — so an
    // email-only customer produces a guaranteed no-op row.
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0007', status: 'confirmed', customerId: CUSTOMER_UUID });
    queueSelects([[{ name: 'سارة', email: 'sara@example.com', phone: null }]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'shipped' });

    expect(outboxRows()).toEqual([]);
  });

  it('still emits for order.confirmed when only an email is on file', async () => {
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0008', status: 'pending', customerId: CUSTOMER_UUID });
    queueSelects([[{ name: null, email: 'sara@example.com', phone: null }]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' });

    const { payload } = onlyEvent();
    expect(payload).toEqual({ orderNumber: 'IRT-2026-0008', customerEmail: 'sara@example.com' });
  });

  it('stamps the tenant on the row and writes it after the status change', async () => {
    // org_id is NOT NULL and carries an RLS policy — an unstamped row would be
    // rejected outright, and a row stamped with the wrong tenant would hand one
    // org's customer contact details to another org's worker poll.
    //
    // Ordering matters too: the outbox insert must come after the UPDATE inside
    // the same withOrg callback. That the handle cannot be `ctx.db` is enforced
    // by the compiler — emitOutboxEvent takes a type only a transaction
    // satisfies — so it is tsc, not this test, that pins that half.
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0009', status: 'pending', customerId: CUSTOMER_UUID });
    queueSelects([[CONTACT]]);

    await caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' });

    const outboxCall = insertCalls().findIndex(isOutbox);
    const row = (mockDb.insert.mock.results[outboxCall].value as { values: { mock: { calls: unknown[][] } } })
      .values.mock.calls[0][0] as { orgId: string };

    expect(row.orgId).toBe('org-1');
    expect(mockDb.insert.mock.invocationCallOrder[outboxCall]).toBeGreaterThan(
      mockDb.update.mock.invocationCallOrder[0],
    );
  });
});

// requirePermission('orders', 'view'|'write') replaced
// protectedProcedure/adminProcedure on list/getById/updateStatus.
// orders.view is granted to every role, so list/getById have no wrong-role
// case — only write (owner, admin) narrows who passes.
describe('orders router — authorization', () => {
  it('updateStatus: member caller rejects FORBIDDEN (requirePermission orders.write)', async () => {
    const caller = ordersRouter.createCaller(ctx('member'));
    await expectCode(
      caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' }),
      'FORBIDDEN',
    );
  });

  it('updateStatus: admin caller is allowed (requirePermission orders.write)', async () => {
    // Same status in and out so the outbox/notification machinery (already
    // covered above) stays out of scope for this authorization check.
    stubOrder({ id: ORDER_UUID, orderNumber: 'IRT-2026-0010', status: 'confirmed', customerId: null });
    queueSelects([[]]);
    mockDb.update = vi.fn(() => chainOf([{ id: ORDER_UUID, status: 'confirmed' }]));

    const caller = ordersRouter.createCaller(ctx('admin'));
    const res = await caller.updateStatus({ id: ORDER_UUID, status: 'confirmed' });

    expect(res.data).toEqual({ id: ORDER_UUID, status: 'confirmed' });
  });
});