import { EGP, zero } from '@irth/domain';
import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { outboxEvents } from '@irth/db';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { courierRouter } from '@/server/routers/courier';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const UUID = '11111111-1111-4111-8111-111111111111';

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

  it('shipments.list: empty db yields { data: [], error: null } envelope', async () => {
    const res = await caller.shipments.list({});
    expect(res).toEqual({ data: [], error: null, meta: null });
  });

  it('shipments.list: filters accepted without changing empty envelope', async () => {
    const res = await caller.shipments.list({ courier: 'bosta', status: 'delivered' });
    expect(res).toEqual({ data: [], error: null, meta: null });
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
    expect(res).toEqual({ data: [], error: null, meta: null });
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
