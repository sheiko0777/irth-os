/**
 * The core defect this session fixed: every Shopify webhook handler used to
 * resolve its org from a single global `SHOPIFY_ORG_ID` env var, regardless
 * of which shop actually sent the webhook. The multi-tenant OAuth connect
 * flow (routes/shopify.ts) lets any number of orgs each connect their own
 * shop, but until this fix, ALL of their webhooks would still land in
 * whichever one org SHOPIFY_ORG_ID names — a real cross-tenant write, not a
 * hypothetical one, the moment a second org connected.
 *
 * `resolveWebhookOrg` is what closes that gap: it resolves org from the
 * request's own `X-Shopify-Shop-Domain` header against `shopify_connections`
 * first, falling back to the legacy env var only when no connection matches
 * (preserving the pre-existing single-tenant integration's behavior
 * unchanged — see shopifyInventoryGuard.test.ts, which sends no shop-domain
 * header at all and still passes against this same file after this fix).
 *
 * `resolveWebhookOrg`/`recordDelivery` aren't exported, so this drives them
 * through the shortest real handler (`/customers-upsert`) rather than
 * unit-testing them in isolation — matches this test file's own house style
 * (shopifyInventoryGuard.test.ts does the same for the idempotency-race fix).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../middlewares/verifyShopifyWebhook', () => ({
  verifyShopifyWebhook: () => async (c: import('hono').Context, next: () => Promise<void>) => {
    c.set('rawBody', await c.req.text());
    await next();
  },
}));

const CONNECTION_A = { id: 'conn-a', orgId: 'org-a' };
const CONNECTION_B = { id: 'conn-b', orgId: 'org-b' };

let connectionsByDomain: Record<string, typeof CONNECTION_A | undefined> = {};
let deliveryInsertCalls: Array<{ connectionId: string; webhookId: string }> = [];
let seenWebhookIds = new Set<string>();
let withOrgContextCalls: string[] = [];

vi.mock('../db', () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          // Only ever called by resolveWebhookOrg's connection lookup in
          // these tests — customers-upsert's own logic is bypassed by the
          // withOrgContext mock below before it can issue its own selects.
          const domain = lastQueriedDomain;
          return Promise.resolve(connectionsByDomain[domain] ? [connectionsByDomain[domain]] : []);
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: { connectionId: string; webhookId: string }) => {
        if (seenWebhookIds.has(`${row.connectionId}:${row.webhookId}`)) {
          return Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
        }
        seenWebhookIds.add(`${row.connectionId}:${row.webhookId}`);
        deliveryInsertCalls.push(row);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  }),
  getEnv: () => ({}), // No legacy SHOPIFY_ORG_ID configured — proves the connection path alone is sufficient.
}));

// The mocked `where()` above can't see which column/value it was called
// with (it's a bare vi.fn), so the test sets this before each request to
// say which domain the next lookup should resolve — a simplification that
// holds because each test issues exactly one connection lookup.
let lastQueriedDomain = '';

/**
 * Generic chainable stub standing in for the transaction handle inside
 * `withOrgContext`. This test only cares about WHICH org the handler was
 * scoped to, not `findOrCreateCustomer`'s own select/insert logic (already
 * exercised for real elsewhere) — so every chain resolves to "nothing found,
 * then a fresh insert succeeds", the shape that lets `findOrCreateCustomer`
 * complete without asserting anything about its internals.
 */
function stubTx() {
  const emptyChain = { from: vi.fn(() => emptyChain), where: vi.fn(() => Promise.resolve([])) };
  const insertedChain = { values: vi.fn(() => insertedChain), returning: vi.fn(() => Promise.resolve([{ id: 'stub-customer-id' }])) };
  return {
    select: vi.fn(() => emptyChain),
    insert: vi.fn(() => insertedChain),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  };
}

vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return {
    ...actual,
    withOrgContext: vi.fn((_db: unknown, orgId: string, fn: (tx: unknown) => unknown) => {
      withOrgContextCalls.push(orgId);
      return fn(stubTx());
    }),
  };
});

import { shopifyWebhookRoute } from '../routes/webhooks/shopify';

function buildApp() {
  const app = new Hono();
  app.route('/webhooks/shopify', shopifyWebhookRoute);
  return app;
}

function post(shopDomain: string | undefined, webhookId: string | undefined) {
  lastQueriedDomain = shopDomain ?? '';
  const headers: Record<string, string> = {};
  if (shopDomain) headers['x-shopify-shop-domain'] = shopDomain;
  if (webhookId) headers['x-shopify-webhook-id'] = webhookId;
  return buildApp().request('/webhooks/shopify/customers-upsert', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 1, email: 'a@example.com' }),
  });
}

describe('Shopify webhook org resolution', () => {
  beforeEach(() => {
    connectionsByDomain = {};
    deliveryInsertCalls = [];
    seenWebhookIds = new Set();
    withOrgContextCalls = [];
    lastQueriedDomain = '';
  });

  it('resolves org from the connection matching X-Shopify-Shop-Domain, not a global fallback', async () => {
    connectionsByDomain = { 'shop-a.myshopify.com': CONNECTION_A };

    const res = await post('shop-a.myshopify.com', 'wh-1');

    expect(res.status).toBe(200);
    expect(withOrgContextCalls).toEqual(['org-a']);
  });

  it('two different orgs each get their own webhooks — no cross-tenant bleed', async () => {
    connectionsByDomain = { 'shop-a.myshopify.com': CONNECTION_A, 'shop-b.myshopify.com': CONNECTION_B };

    await post('shop-a.myshopify.com', 'wh-2');
    await post('shop-b.myshopify.com', 'wh-3');

    expect(withOrgContextCalls).toEqual(['org-a', 'org-b']);
  });

  it('an unknown shop domain with no legacy SHOPIFY_ORG_ID configured is refused, not silently misrouted', async () => {
    connectionsByDomain = {};

    const res = await post('unknown-shop.myshopify.com', 'wh-4');

    expect(res.status).toBe(404);
    expect(withOrgContextCalls).toEqual([]);
  });

  it('a redelivered webhook (same connection + webhook id) is not reprocessed a second time', async () => {
    connectionsByDomain = { 'shop-a.myshopify.com': CONNECTION_A };

    const first = await post('shop-a.myshopify.com', 'wh-dup');
    const second = await post('shop-a.myshopify.com', 'wh-dup');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ data: { alreadyProcessed: true }, error: null, meta: null });
    // Only the first delivery actually reached withOrgContext / the handler body.
    expect(withOrgContextCalls).toEqual(['org-a']);
  });
});
