import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection = { id: 'conn-a', orgId: 'org-a', shopDomain: 'shop-a.myshopify.com' };

let connectionLookup: typeof connection | null;
let existingDelivery: { id: string; status: string } | null;
let insertedRows: Array<Record<string, unknown>>;
let insertTxs: unknown[];
let emitCalls: Array<{ tx: unknown; event: { orgId: string; eventType: string; payload: Record<string, string> } }>;
let warnCalls: unknown[][];

const emitOutboxEventMock = vi.hoisted(() => vi.fn(async (tx: unknown, event: { orgId: string; eventType: string; payload: Record<string, string> }) => {
  emitCalls.push({ tx, event });
}));

vi.mock('@irth/db', () => ({
  safeEqual: (left: string, right: string, encoding: BufferEncoding) => {
    const a = Buffer.from(left, encoding);
    const b = Buffer.from(right, encoding);
    return a.length === b.length && timingSafeEqual(a, b);
  },
  isUniqueViolation: (e: { code?: string; cause?: { code?: string } }) => (e?.cause?.code ?? e?.code) === '23505',
  emitOutboxEvent: emitOutboxEventMock,
  // The route writes under the tenant context; the fake db's transaction
  // stands in for it so insert and outbox emit still share one tx object.
  withOrgContext: (db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }, _orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    db.transaction(fn),
  inboundDeliveries: {
    id: 'id',
    orgId: 'orgId',
    provider: 'provider',
    connectionId: 'connectionId',
    deliveryKey: 'deliveryKey',
    topic: 'topic',
    rawBody: 'rawBody',
    headers: 'headers',
    bodySha256: 'bodySha256',
    apiVersion: 'apiVersion',
    eventId: 'eventId',
    triggeredAt: 'triggeredAt',
    payload: 'payload',
    status: 'status',
  },
  shopifyConnections: {
    id: 'id',
    orgId: 'orgId',
    shopDomain: 'shopDomain',
    status: 'status',
    lastWebhookAt: 'lastWebhookAt',
  },
}));

vi.mock('../db', () => ({
  getEnv: () => ({ SHOPIFY_APP_CLIENT_SECRET: 'test-secret' }),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => (connectionLookup ? [connectionLookup] : []),
      }),
    }),
    transaction: async (fn: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>) => fn(fakeTx()),
  }),
}));

import { shopifyInboxRoute } from '../routes/webhooks/shopifyInbox';

function fakeTx() {
  const tx = {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            insertTxs.push(tx);
            if (existingDelivery) return [];
            insertedRows.push(row);
            return [{ id: row.id }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => (existingDelivery ? [existingDelivery] : []),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
  return tx;
}

function app() {
  const hono = new Hono();
  hono.route('/webhooks/shopify/inbox', shopifyInboxRoute);
  return hono;
}

function sign(bytes: Uint8Array): string {
  return createHmac('sha256', 'test-secret').update(bytes).digest('base64');
}

function post(path: string, bytes: Uint8Array, webhookId = 'wh-1', shopDomain = connection.shopDomain) {
  return app().request(`/webhooks/shopify/inbox/${path}`, {
    method: 'POST',
    headers: {
      'x-shopify-hmac-sha256': sign(bytes),
      'x-shopify-shop-domain': shopDomain,
      'x-shopify-webhook-id': webhookId,
      'x-shopify-api-version': '2026-07',
    },
    body: bytes,
  });
}

describe('Shopify inbox webhook route', () => {
  beforeEach(() => {
    connectionLookup = connection;
    existingDelivery = null;
    insertedRows = [];
    insertTxs = [];
    emitCalls = [];
    warnCalls = [];
    emitOutboxEventMock.mockClear();
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnCalls.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves invalid UTF-8 bytes after HMAC verification and enqueues processing', async () => {
    const bytes = Uint8Array.from([0x7b, 0xff, 0x7d]);

    const res = await post('orders-paid', bytes);

    expect(res.status).toBe(200);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      orgId: 'org-a',
      provider: 'shopify',
      connectionId: 'conn-a',
      deliveryKey: 'wh-1',
      topic: 'orders/paid',
      apiVersion: '2026-07',
      payload: null,
      status: 'received',
    });
    expect(Array.from(insertedRows[0].rawBody as Uint8Array)).toEqual([0x7b, 0xff, 0x7d]);
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].event).toMatchObject({
      orgId: 'org-a',
      eventType: 'inbound.delivery.process',
      payload: { orgId: 'org-a' },
    });
    expect(emitCalls[0].event.payload.deliveryId).toEqual(insertedRows[0].id);
  });

  it('does not enqueue a duplicate delivery already marked processed', async () => {
    existingDelivery = { id: 'delivery-processed', status: 'processed' };

    const res = await post('orders-updated', new TextEncoder().encode('{"id":1}'), 'wh-dup');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { alreadyProcessed: true }, error: null, meta: null });
    expect(insertedRows).toEqual([]);
    expect(emitCalls).toEqual([]);
  });

  it('re-enqueues a redelivery whose inbox row is failed', async () => {
    existingDelivery = { id: 'delivery-failed', status: 'failed' };

    const res = await post('orders-edited', new TextEncoder().encode('{"id":2}'), 'wh-retry');

    expect(res.status).toBe(200);
    expect(insertedRows).toEqual([]);
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].event).toEqual({
      orgId: 'org-a',
      eventType: 'inbound.delivery.process',
      payload: { orgId: 'org-a', deliveryId: 'delivery-failed' },
    });
  });

  it('inserts the inbox row and emits outbox on the same transaction object', async () => {
    const res = await post('refunds-create', new TextEncoder().encode('{"id":3}'), 'wh-same-tx');

    expect(res.status).toBe(200);
    expect(insertTxs).toHaveLength(1);
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].tx).toBe(insertTxs[0]);
  });

  it('returns 404 and logs a structured line for an unknown shop domain', async () => {
    connectionLookup = null;

    const res = await post('fulfillments-update', new TextEncoder().encode('{"id":4}'), 'wh-unknown', 'missing.myshopify.com');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ data: null, error: 'no_matching_connection', meta: null });
    expect(insertedRows).toEqual([]);
    expect(emitCalls).toEqual([]);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][0]).toBe('shopify_webhook.no_matching_connection');
    expect(warnCalls[0][1]).toMatchObject({ topic: 'fulfillments/update' });
  });
});
