import { EGP, zero } from '@irth/domain';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { outboxEvents } from '@irth/db';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { courierRouter } from '@/server/routers/courier';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const UUID = '11111111-1111-4111-8111-111111111111';

function queryResult(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit', 'offset']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (result: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
  } as unknown as Context;
}

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

describe('courier router', () => {
  const caller = courierRouter.createCaller(ctx('owner'));

  beforeEach(() => mockDb._reset());

  it('shipments.list: empty db yields { data: [], error: null } envelope', async () => {
    const res = await caller.shipments.list({});
    expect(res).toEqual({ data: [], error: null, meta: { total: 0, page: 1, pageSize: 20 } });
  });

  it('shipments.list: filters accepted without changing empty envelope', async () => {
    const res = await caller.shipments.list({ courier: 'bosta', status: 'delivered' });
    expect(res).toEqual({ data: [], error: null, meta: { total: 0, page: 1, pageSize: 20 } });
  });

  it('shipments.list: paginates filtered rows while retaining the filtered total', async () => {
    const firstPage = queryResult([{ id: 'shipment-1', orgId: 'org-1', courier: 'bosta', courierStatus: 'delivered' }]);
    const firstCount = queryResult([{ count: 3 }]);
    const secondPage = queryResult([{ id: 'shipment-2', orgId: 'org-1', courier: 'bosta', courierStatus: 'delivered' }]);
    const secondCount = queryResult([{ count: 3 }]);
    mockDb.select
      .mockReturnValueOnce(firstPage as never)
      .mockReturnValueOnce(firstCount as never)
      .mockReturnValueOnce(secondPage as never)
      .mockReturnValueOnce(secondCount as never);

    const filters = { courier: 'bosta', status: 'delivered', pageSize: 1 };
    const page1 = await caller.shipments.list({ ...filters, page: 1 });
    const page2 = await caller.shipments.list({ ...filters, page: 2 });

    expect(page1.data).not.toEqual(page2.data);
    expect(page1.meta).toEqual({ total: 3, page: 1, pageSize: 1 });
    expect(page2.meta).toEqual({ total: 3, page: 2, pageSize: 1 });
    expect(firstPage.limit).toHaveBeenCalledWith(1);
    expect(firstPage.offset).toHaveBeenCalledWith(0);
    expect(secondPage.limit).toHaveBeenCalledWith(1);
    expect(secondPage.offset).toHaveBeenCalledWith(1);
  });

  it('shipments.markRemitted: malformed shipment uuid rejects BAD_REQUEST', async () => {
    await expectCode(
      caller.shipments.markRemitted({ shipmentId: 'not-a-uuid', remittanceId: 'r-1' }),
      'BAD_REQUEST'
    );
  });

  it('shipments.markRemitted: no matching row resolves with undefined data (current behavior)', async () => {
    const res = await caller.shipments.markRemitted({ shipmentId: UUID, remittanceId: 'r-1' });
    expect(res.error).toBeNull();
    expect(res.data).toBeUndefined();
  });

  it('remittances.list: empty db yields { data: [], error: null } envelope', async () => {
    const res = await caller.remittances.list({});
    expect(res).toEqual({ data: [], error: null, meta: { total: 0, page: 1, pageSize: 20 } });
  });

  it('remittances.list: paginates status-filtered rows while retaining the filtered total', async () => {
    const firstPage = queryResult([{ id: 'remittance-1', orgId: 'org-1', status: 'pending' }]);
    const firstCount = queryResult([{ count: 3 }]);
    const secondPage = queryResult([{ id: 'remittance-2', orgId: 'org-1', status: 'pending' }]);
    const secondCount = queryResult([{ count: 3 }]);
    mockDb.select
      .mockReturnValueOnce(firstPage as never)
      .mockReturnValueOnce(firstCount as never)
      .mockReturnValueOnce(secondPage as never)
      .mockReturnValueOnce(secondCount as never);

    const page1 = await caller.remittances.list({ status: 'pending', page: 1, pageSize: 1 });
    const page2 = await caller.remittances.list({ status: 'pending', page: 2, pageSize: 1 });

    expect(page1.data).not.toEqual(page2.data);
    expect(page1.meta).toEqual({ total: 3, page: 1, pageSize: 1 });
    expect(page2.meta).toEqual({ total: 3, page: 2, pageSize: 1 });
    expect(firstPage.offset).toHaveBeenCalledWith(0);
    expect(secondPage.offset).toHaveBeenCalledWith(1);
  });

  it('remittances.create: missing required fields rejects BAD_REQUEST', async () => {
    await expectCode(
      caller.remittances.create({ courier: 'bosta', reference: 'ref-1' } as never),
      'BAD_REQUEST'
    );
  });

  it('remittances.reconcile: missing remittance rejects NOT_FOUND', async () => {
    await expectCode(caller.remittances.reconcile({ remittanceId: UUID }), 'NOT_FOUND');
  });

  it('remittances.reconcile: malformed uuid rejects BAD_REQUEST', async () => {
    await expectCode(caller.remittances.reconcile({ remittanceId: 'nope' }), 'BAD_REQUEST');
  });

  /**
   * Deliberate absence, pinned so it stays deliberate.
   *
   * Every procedure in this router moves COD money between us and the courier:
   * markRemitted, remittances.create, remittances.reconcile. None of them is a
   * transition the customer hears about, and the outbox worker
   * (apps/api/src/workers/outboxWorker.ts) only branches on order.confirmed and
   * order.shipped — so an event queued here would be polled, match no branch,
   * and be marked processed having sent nothing, while looking like a delivered
   * notification on the Integrations screen.
   *
   * The shipping transitions that DO warrant order.shipped arrive on the
   * courier webhooks in apps/api, not through this router.
   */
  it('COD settlement queues no customer notification', async () => {
    await caller.shipments.markRemitted({ shipmentId: UUID, remittanceId: 'r-1' });

    // The mock declares `insert: vi.fn(() => chainable())` — no parameters — so
    // vitest types each recorded call as the empty tuple. The table argument is
    // genuinely there at runtime; only its type is missing.
    const calls = mockDb.insert.mock.calls as unknown as unknown[][];
    const toOutbox = calls.filter(
      (c) => getTableName(c[0] as Parameters<typeof getTableName>[0]) === getTableName(outboxEvents),
    );
    expect(toOutbox).toEqual([]);
  });

  it('summary: aggregates over empty db are all zero with empty status map', async () => {
    const res = await caller.summary();
    expect(res).toEqual({
      data: {
        totalCodCollected: zero(EGP),
        totalCodRemitted: zero(EGP),
        pendingRemittance: zero(EGP),
        shipmentsByStatus: {},
      },
      error: null,
      meta: null,
    });
  });
});
