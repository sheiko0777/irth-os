import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

vi.mock('../db', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
  getDb: vi.fn(),
  getEnv: () => ({ BOSTA_WEBHOOK_SECRET: 'test-secret', ARAMEX_WEBHOOK_TOKEN: 'test-token' }),
}));

vi.mock('@irth/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@irth/db')>(),
  withOrgContext: vi.fn(),
  buildOrderNotification: vi.fn(),
  emitOutboxEvent: vi.fn(),
}));

import { db } from '../db';
import { courierShipments, withOrgContext, buildOrderNotification, emitOutboxEvent } from '@irth/db';
import { bostaWebhookRoute } from '../routes/webhooks/bosta-webhook';
import { aramexWebhookRoute } from '../routes/webhooks/aramex-webhook';

type Courier = 'bosta' | 'aramex';
const TRACKING = 'recycled-waybill';
const dialect = new PgDialect();
const updateWhere = vi.fn();
const set = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set }));
const order = { id: 'order-a', orderNumber: '100', customerId: 'customer-a' };
const tx = {
  update,
  select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [order] }) }) })),
};

function shipment(courier: Courier, orgId = 'org-a', trackingNumber = TRACKING) {
  return {
    id: `shipment-${orgId}`, orgId, orderId: `order-${orgId}`, courier,
    trackingNumber, courierStatus: 'created', codCollected: false, webhookEvents: [],
  };
}

// Execute the real Drizzle predicates against fixtures, rather than returning
// canned rows regardless of WHERE. Removing either filter must break the tests.
function lookup(rows: ReturnType<typeof shipment>[]) {
  const limit = vi.fn();
  const where = vi.fn((predicate: SQL) => {
    const query = dialect.sqlToQuery(predicate);
    const filters = [...query.sql.matchAll(/"courier_shipments"\."(courier|tracking_number)" = \$(\d+)/g)];
    const matching = rows.filter(row => filters.every(([, column, parameter]) =>
      row[column === 'courier' ? 'courier' : 'trackingNumber'] === query.params[Number(parameter) - 1],
    ));
    limit.mockImplementation(async (count: number) => matching.slice(0, count));
    return { limit, then: (resolve: (value: unknown) => void) => Promise.resolve(matching).then(resolve) };
  });
  const from = vi.fn(() => ({ where }));
  vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
  return { from, where, limit };
}

function post(courier: Courier, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify(courier === 'bosta'
    ? { data: { trackingNumber: TRACKING, state: 'PACKAGE_PICKED_UP', ...extra } }
    : { WaybillNumber: TRACKING, UpdateCode: 'SH001', ...extra });
  const headers: Record<string, string> = courier === 'bosta'
    ? { 'X-Bosta-Signature': createHmac('sha256', 'test-secret').update(body).digest('hex') }
    : { 'X-Aramex-Token': 'test-token' };
  return (courier === 'bosta' ? bostaWebhookRoute : aramexWebhookRoute).request('/', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withOrgContext).mockImplementation(async (_db, _orgId, fn) =>
    fn(tx as unknown as Parameters<typeof fn>[0]));
  vi.mocked(buildOrderNotification).mockResolvedValue({
    orderNumber: order.orderNumber, customerPhone: '01000000000',
  });
});

describe.each(['bosta', 'aramex'] as const)('%s courier shipment resolution', (courier) => {
  it('processes a single matching shipment and emits the shipped notification', async () => {
    const query = lookup([shipment(courier)]);
    const res = await post(courier);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(query.from).toHaveBeenCalledWith(courierShipments);
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(withOrgContext).toHaveBeenCalledWith(undefined, 'org-a', expect.any(Function));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ courierStatus: 'picked_up' }));
    expect(buildOrderNotification).toHaveBeenCalledWith(tx, 'org-a', order, 'order.shipped');
    expect(emitOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ orgId: 'org-a', eventType: 'order.shipped' }));
  });

  it('refuses same-courier collisions across orgs before any downstream work', async () => {
    lookup([shipment(courier), shipment(courier, 'org-b')]);
    const res = await post(courier, { businessReference: 'order-fallback' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ data: null, error: 'ambiguous_tracking_number', meta: null });
    expect(withOrgContext).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(buildOrderNotification).not.toHaveBeenCalled();
    expect(emitOutboxEvent).not.toHaveBeenCalled();
  });

  it('excludes another courier with the same waybill and the same courier with another waybill', async () => {
    lookup([
      shipment(courier === 'bosta' ? 'aramex' : 'bosta', 'org-b'),
      shipment(courier, 'org-c', 'different-waybill'),
      shipment(courier),
    ]);
    const res = await post(courier);
    expect(res.status).toBe(200);
    expect(withOrgContext).toHaveBeenCalledTimes(1);
    expect(withOrgContext).toHaveBeenCalledWith(undefined, 'org-a', expect.any(Function));
    expect(update).toHaveBeenCalledTimes(1);
    expect(emitOutboxEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ orgId: 'org-a' }));
  });

  it.each(['empty', 'other-courier'])('preserves not-found handling for %s matches', async (scenario) => {
    lookup(scenario === 'empty' ? [] : [shipment(courier === 'bosta' ? 'aramex' : 'bosta')]);
    const res = await post(courier);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      data: null, error: courier === 'bosta' ? 'shipment_not_found_and_no_reference' : 'shipment_not_found', meta: null,
    });
    expect(withOrgContext).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(emitOutboxEvent).not.toHaveBeenCalled();
  });
});
