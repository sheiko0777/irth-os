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
 * Driven through `/inventory-levels-update` specifically (not
 * `/customers-upsert` or `/orders-create`): with no matching product
 * variant, that handler returns right after `recordDelivery` and never
 * reaches `withOrgContext` — so this file has no need to mock
 * `withOrgContext` at all, unlike an earlier version of this test. That
 * earlier version DID mock it, and that mock is a module-level override of
 * the same `@irth/db` export `shopifyInventoryGuard.test.ts` in this same
 * directory ALSO overrides (to unconditionally reject) — passed reliably
 * locally, failed in CI, exactly the shape of a cross-file mock collision.
 * Asserting on `deliveryInsertCalls`'s recorded `orgId` instead of a
 * `withOrgContext` spy proves the identical thing (which org a webhook gets
 * attributed to) without sharing any mocked export with another file.
 *
 * `process.env.SHOPIFY_ORG_ID` is explicitly stubbed empty for the "no
 * connection, no legacy org" case — the earlier version implicitly relied on
 * it being unset in whatever ran the suite, which does not hold in CI.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
let lastQueriedDomain = '';
let deliveryInsertCalls: Array<{ orgId: string; connectionId: string | null; webhookId: string }> = [];
let seenWebhookIds = new Set<string>();
// The handler issues exactly two `select().from().where()` calls in a fixed
// order when it reaches this far: (1) resolveWebhookOrg's shopify_connections
// lookup, (2) the product_variants match check. Distinguishing them by call
// order rather than introspecting the table argument — a real Drizzle
// pgTable's name lives behind a Symbol key, not a plain `.name` property, so
// checking `table.name` here would silently never match either branch.
let selectCallIndex = 0;

vi.mock('../db', () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const callIndex = selectCallIndex++;
          if (callIndex === 0) {
            // resolveWebhookOrg's connection lookup.
            const domain = lastQueriedDomain;
            return Promise.resolve(connectionsByDomain[domain] ? [connectionsByDomain[domain]] : []);
          }
          // The product_variants match check — always miss, so the handler
          // returns right after recordDelivery and never reaches
          // withOrgContext, which this file deliberately never mocks.
          return Promise.resolve([]);
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: { orgId: string; connectionId: string | null; webhookId: string }) => {
        const key = `${row.connectionId}:${row.webhookId}`;
        if (seenWebhookIds.has(key)) {
          return Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
        }
        seenWebhookIds.add(key);
        deliveryInsertCalls.push(row);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  }),
  getEnv: () => ({}),
}));

// `shopifyConnections`/`shopifyWebhookDeliveries` need to exist as SOME
// truthy object — `where(and(eq(shopifyConnections.shopDomain, …)))` in
// resolveWebhookOrg evaluates them for real before the mocked `where()`
// above ever runs — but NOT the real Drizzle table object. `eq()`/`and()`
// (real, unmocked, from drizzle-orm) just build an AST node referencing
// whatever `column` they're handed; they never validate its shape, and the
// mocked `getDb` above ignores its own arguments entirely regardless. Real
// SQL never actually runs here, so a plain hand-built stand-in is enough —
// deliberately NOT spread from `importOriginal()`.
//
// Two earlier versions of this file went through `@irth/db`'s real module
// (once unmocked, once via `{...await importOriginal()}`) and both passed on
// every local run but failed in CI with `shopifyConnections` resolving
// undefined — `TypeError: Cannot read properties of undefined (reading
// 'id')` unmocked, then Vitest's own "No 'shopifyConnections' export is
// defined on the '@irth/db' mock" guard once spread-mocked. Same underlying
// symptom both times, so this isn't a mock-shape mistake — importing the
// real `@irth/db` module resolves inconsistently in CI's environment for
// this file specifically (module-graph timing this file never needed to
// depend on in the first place). Sidestepping it entirely, rather than
// continuing to chase why, is the robust fix.
vi.mock('@irth/db', () => ({
  shopifyConnections: { id: 'id', orgId: 'orgId', shopDomain: 'shopDomain', status: 'status' },
  shopifyWebhookDeliveries: { orgId: 'orgId', connectionId: 'connectionId', webhookId: 'webhookId', topic: 'topic', payload: 'payload' },
  // Referenced by the /inventory-levels-update handler's variant lookup
  // (`eq(productVariants.orgId, ...)`) even though the mocked `where()`
  // above always makes that lookup miss — the reference is still evaluated
  // to build the (discarded) query expression before `where()` short-circuits.
  productVariants: { orgId: 'orgId', shopifyInventoryItemId: 'shopifyInventoryItemId' },
}));

import { shopifyWebhookRoute } from '../routes/webhooks/shopify';

function buildApp() {
  const app = new Hono();
  app.route('/webhooks/shopify', shopifyWebhookRoute);
  return app;
}

function post(shopDomain: string | undefined, webhookId: string | undefined) {
  lastQueriedDomain = shopDomain ?? '';
  selectCallIndex = 0; // Reset per request, not per test — a test can post() more than once.
  const headers: Record<string, string> = {};
  if (shopDomain) headers['x-shopify-shop-domain'] = shopDomain;
  if (webhookId) headers['x-shopify-webhook-id'] = webhookId;
  return buildApp().request('/webhooks/shopify/inventory-levels-update', {
    method: 'POST',
    headers,
    body: JSON.stringify({ inventory_item_id: 1, available: 5 }),
  });
}

describe('Shopify webhook org resolution', () => {
  const originalShopifyOrgId = process.env.SHOPIFY_ORG_ID;

  beforeEach(() => {
    connectionsByDomain = {};
    deliveryInsertCalls = [];
    seenWebhookIds = new Set();
    lastQueriedDomain = '';
    selectCallIndex = 0;
    delete process.env.SHOPIFY_ORG_ID;
  });

  afterEach(() => {
    if (originalShopifyOrgId === undefined) delete process.env.SHOPIFY_ORG_ID;
    else process.env.SHOPIFY_ORG_ID = originalShopifyOrgId;
  });

  it('resolves org from the connection matching X-Shopify-Shop-Domain, not a global fallback', async () => {
    connectionsByDomain = { 'shop-a.myshopify.com': CONNECTION_A };

    const res = await post('shop-a.myshopify.com', 'wh-1');

    expect(res.status).toBe(200);
    expect(deliveryInsertCalls).toHaveLength(1);
    expect(deliveryInsertCalls[0]).toMatchObject({ orgId: 'org-a', connectionId: 'conn-a', webhookId: 'wh-1' });
  });

  it('two different orgs each get their own webhooks — no cross-tenant bleed', async () => {
    connectionsByDomain = { 'shop-a.myshopify.com': CONNECTION_A, 'shop-b.myshopify.com': CONNECTION_B };

    await post('shop-a.myshopify.com', 'wh-2');
    await post('shop-b.myshopify.com', 'wh-3');

    expect(deliveryInsertCalls.map((c) => c.orgId)).toEqual(['org-a', 'org-b']);
  });

  it('an unknown shop domain with no legacy SHOPIFY_ORG_ID configured is refused, not silently misrouted', async () => {
    connectionsByDomain = {};

    const res = await post('unknown-shop.myshopify.com', 'wh-4');

    expect(res.status).toBe(404);
    expect(deliveryInsertCalls).toEqual([]);
  });

  it('a redelivered webhook (same connection + webhook id) is not reprocessed a second time', async () => {
    connectionsByDomain = { 'shop-a.myshopify.com': CONNECTION_A };

    const first = await post('shop-a.myshopify.com', 'wh-dup');
    const second = await post('shop-a.myshopify.com', 'wh-dup');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ data: { alreadyProcessed: true }, error: null, meta: null });
    // Only the first delivery was actually recorded — the second short-circuited.
    expect(deliveryInsertCalls).toHaveLength(1);
  });
});
