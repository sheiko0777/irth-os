import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encryptShopifyToken, registerShopifyWebhooks } from '../services/shopifyConnection';

// A tiny in-memory Shopify Admin GraphQL: just enough of webhookSubscriptions
// (list by topic), webhookSubscriptionCreate and webhookSubscriptionDelete to
// observe what registerShopifyWebhooks does to a shop's subscriptions.
interface Subscription { id: string; topic: string; callbackUrl: string }

const API_BASE = 'https://api.example.test';
const ORDERS_BASE = `${API_BASE}/api/webhooks/shopify`;

let subscriptions: Subscription[] = [];
let mutations: string[] = [];
let failCreateFor = new Set<string>();
let nextId = 1;

function stubShopify() {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, any> };
    const respond = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

    if (query.includes('GetWebhooks')) {
      const nodes = subscriptions
        .filter((s) => s.topic === variables.topic)
        .map((s) => ({ id: s.id, endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl: s.callbackUrl } }));
      return respond({ webhookSubscriptions: { nodes } });
    }
    if (query.includes('DeleteWebhook')) {
      mutations.push(`delete ${variables.id}`);
      subscriptions = subscriptions.filter((s) => s.id !== variables.id);
      return respond({ webhookSubscriptionDelete: { userErrors: [] } });
    }
    if (query.includes('CreateWebhook')) {
      mutations.push(`create ${variables.topic} ${variables.input.callbackUrl}`);
      if (failCreateFor.has(variables.topic)) {
        return respond({ webhookSubscriptionCreate: { userErrors: [{ message: 'boom' }] } });
      }
      subscriptions.push({ id: `gid://shopify/WebhookSubscription/${nextId++}`, topic: variables.topic, callbackUrl: variables.input.callbackUrl });
      return respond({ webhookSubscriptionCreate: { userErrors: [] } });
    }
    throw new Error(`unexpected GraphQL operation: ${query.slice(0, 60)}`);
  }));
}

let connection: Parameters<typeof registerShopifyWebhooks>[0];

beforeAll(async () => {
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const sealed = await encryptShopifyToken('shpat_test_token');
  connection = { shopDomain: 'test-shop.myshopify.com', accessTokenCiphertext: sealed.ciphertext, accessTokenIv: sealed.iv } as typeof connection;
});

afterEach(() => {
  vi.unstubAllGlobals();
  subscriptions = [];
  mutations = [];
  failCreateFor = new Set();
  nextId = 1;
});

function callbackFor(topic: string): string | undefined {
  return subscriptions.find((s) => s.topic === topic)?.callbackUrl;
}

describe('registerShopifyWebhooks', () => {
  it('registers the three order topics on the real handlers, not the receive-only inbox', async () => {
    stubShopify();
    const errors = await registerShopifyWebhooks(connection, API_BASE);

    expect(errors).toEqual([]);
    // OR-10 (promotion) is not built, so inbox/orders-* would store the delivery and create nothing.
    expect(callbackFor('ORDERS_CREATE')).toBe(`${ORDERS_BASE}/orders-create`);
    expect(callbackFor('ORDERS_UPDATED')).toBe(`${ORDERS_BASE}/orders-updated`);
    expect(callbackFor('ORDERS_CANCELLED')).toBe(`${ORDERS_BASE}/orders-cancelled`);
    // Everything else keeps its existing route.
    expect(callbackFor('ORDERS_EDITED')).toBe(`${ORDERS_BASE}/inbox/orders-edited`);
    expect(callbackFor('REFUNDS_CREATE')).toBe(`${ORDERS_BASE}/inbox/refunds-create`);
    expect(callbackFor('CUSTOMERS_CREATE')).toBe(`${ORDERS_BASE}/customers-upsert`);
  });

  it('is idempotent: a second run changes nothing', async () => {
    stubShopify();
    await registerShopifyWebhooks(connection, API_BASE);
    const afterFirst = mutations.length;

    const errors = await registerShopifyWebhooks(connection, API_BASE);

    expect(errors).toEqual([]);
    expect(mutations.length).toBe(afterFirst);
  });

  it('re-points a shop already registered against the inbox routes', async () => {
    stubShopify();
    subscriptions.push({ id: 'gid://shopify/WebhookSubscription/legacy', topic: 'ORDERS_CREATE', callbackUrl: `${ORDERS_BASE}/inbox/orders-create` });

    const errors = await registerShopifyWebhooks(connection, API_BASE);

    expect(errors).toEqual([]);
    expect(mutations).toContain('delete gid://shopify/WebhookSubscription/legacy');
    expect(subscriptions.filter((s) => s.topic === 'ORDERS_CREATE').map((s) => s.callbackUrl)).toEqual([`${ORDERS_BASE}/orders-create`]);
  });

  it('keeps going when one topic fails and reports every failure', async () => {
    stubShopify();
    failCreateFor = new Set(['ORDERS_PAID', 'REFUNDS_CREATE']);

    const errors = await registerShopifyWebhooks(connection, API_BASE);

    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('ORDERS_PAID');
    expect(errors.join('\n')).toContain('REFUNDS_CREATE');
    // The topics after the failures were still registered.
    expect(callbackFor('ORDERS_CREATE')).toBeDefined();
    expect(callbackFor('INVENTORY_LEVELS_UPDATE')).toBeDefined();
    expect(callbackFor('ORDERS_PAID')).toBeUndefined();
  });
});
