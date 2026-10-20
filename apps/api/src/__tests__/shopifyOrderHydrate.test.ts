import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptShopifyToken } from '../services/shopifyConnection';
import {
  ORDER_QUERY,
  hydrateShopifyOrder,
  SHOPIFY_ORDER_HYDRATE_API_VERSION,
  type ShopifyOrderGraph,
} from '../services/shopifyOrderHydrate';

type FetchCall = { url: string; variables: Record<string, unknown> };

const ORDER_ID = 'gid://shopify/Order/1001';

beforeEach(() => {
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('hydrateShopifyOrder', () => {
  it('hydrates a 300-line order over two lineItems pages', async () => {
    const connection = await testConnection();
    const calls: FetchCall[] = [];
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const variables = readVariables(init);
      calls.push({ url: String(input), variables });
      const after = variables.lineItemsAfter;
      return jsonResponse({
        data: {
          order: orderPage({
            from: after === null ? 1 : 251,
            count: after === null ? 250 : 50,
            hasNextPage: after === null,
            endCursor: after === null ? 'cursor-250' : null,
          }),
        },
      });
    });

    const result = await hydrateShopifyOrder(connection, ORDER_ID, { fetch });

    expect(result.apiVersion).toBe('2026-07');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('/admin/api/2026-07/graphql.json');
    expect(result.pages).toHaveLength(2);
    expect(result.order?.lineItems?.edges).toHaveLength(300);
    expect(result.paginationComplete).toBe(true);
    expect(result.sectionsFetch.items).toBe('loaded');
  });

  it('classifies protected customer data redaction without throwing', async () => {
    const connection = await testConnection();
    const fetch = vi.fn(async () => jsonResponse({
      data: {
        order: {
          ...orderPage({ from: 1, count: 1, hasNextPage: false, endCursor: null }),
          customer: null,
          shippingAddress: null,
          billingAddress: null,
        },
      },
      errors: [
        {
          message: 'not approved to access protected customer data',
          path: ['order', 'customer'],
        },
      ],
    }));

    const result = await hydrateShopifyOrder(connection, ORDER_ID, { fetch });

    expect(result.sectionsFetch.buyer).toBe('permission_denied');
    expect(result.sectionsFetch.addresses).toBe('permission_denied');
    expect(result.sectionsFetch.items).toBe('loaded');
    expect(result.sectionsFetch.payment).toBe('loaded');
    expect(result.paginationComplete).toBe(true);
  });

  it('backs off twice for THROTTLED responses and then succeeds', async () => {
    const connection = await testConnection();
    const sleep = vi.fn(async () => undefined);
    const fetch = responseSequence([
      throttledResponse(),
      throttledResponse(),
      { data: { order: orderPage({ from: 1, count: 1, hasNextPage: false, endCursor: null }) } },
    ]);

    const result = await hydrateShopifyOrder(connection, ORDER_ID, { fetch, sleep });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(result.order?.id).toBe(ORDER_ID);
    expect(result.sectionsFetch.items).toBe('loaded');
  });

  it('marks fetch_failed after the fourth THROTTLED response', async () => {
    const connection = await testConnection();
    const sleep = vi.fn(async () => undefined);
    const fetch = responseSequence([
      throttledResponse(),
      throttledResponse(),
      throttledResponse(),
      throttledResponse(),
    ]);

    const result = await hydrateShopifyOrder(connection, ORDER_ID, { fetch, sleep });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(result.order).toBeNull();
    expect(result.paginationComplete).toBe(false);
    expect(Object.values(result.sectionsFetch).every((status) => status === 'fetch_failed')).toBe(true);
  });

  it('marks HTTP 502 as fetch_failed', async () => {
    const connection = await testConnection();
    const fetch = vi.fn(async () => jsonResponse({ errors: [{ message: 'bad gateway' }] }, 502));

    const result = await hydrateShopifyOrder(connection, ORDER_ID, { fetch });

    expect(result.order).toBeNull();
    expect(result.paginationComplete).toBe(false);
    expect(Object.values(result.sectionsFetch).every((status) => status === 'fetch_failed')).toBe(true);
  });

  it('records the packet API version', async () => {
    const connection = await testConnection();
    const fetch = vi.fn(async () => jsonResponse({
      data: { order: orderPage({ from: 1, count: 1, hasNextPage: false, endCursor: null }) },
    }));

    const result = await hydrateShopifyOrder(connection, ORDER_ID, { fetch });

    expect(SHOPIFY_ORDER_HYDRATE_API_VERSION).toBe('2026-07');
    expect(result.apiVersion).toBe('2026-07');
  });

  it('keeps required Shopify fields in the order query contract', () => {
    for (const field of [
      'lineItems',
      'refunds',
      'fulfillments',
      'shippingLines',
      'discountApplications',
      'customer',
      'shippingAddress',
      'billingAddress',
      'transactions',
    ]) {
      expect(ORDER_QUERY).toContain(field);
    }
  });
});

async function testConnection() {
  const token = await encryptShopifyToken('test-access-token');
  return {
    shopDomain: 'unit-test-shop.myshopify.com',
    accessTokenCiphertext: token.ciphertext,
    accessTokenIv: token.iv,
  };
}

function orderPage(input: {
  from: number;
  count: number;
  hasNextPage: boolean;
  endCursor: string | null;
}): ShopifyOrderGraph {
  return {
    id: ORDER_ID,
    name: '#1001',
    email: 'buyer@example.test',
    phone: '+201000000000',
    customer: { id: 'gid://shopify/Customer/1', displayName: 'Example Buyer', email: 'buyer@example.test' },
    shippingAddress: { address1: '1 Test Street', city: 'Cairo', countryCode: 'EG' },
    billingAddress: { address1: '1 Test Street', city: 'Cairo', countryCode: 'EG' },
    transactions: [],
    refunds: [],
    fulfillments: [],
    shippingLines: { edges: [] },
    discountApplications: { edges: [] },
    lineItems: {
      pageInfo: { hasNextPage: input.hasNextPage, endCursor: input.endCursor },
      edges: Array.from({ length: input.count }, (_, index) => {
        const lineNumber = input.from + index;
        return {
          cursor: `cursor-${lineNumber}`,
          node: {
            id: `gid://shopify/LineItem/${lineNumber}`,
            title: `Synthetic line ${lineNumber}`,
            quantity: 1,
            discountedUnitPriceSet: {
              shopMoney: { amount: '10.00', currencyCode: 'EGP' },
              presentmentMoney: { amount: '10.00', currencyCode: 'EGP' },
            },
          },
        };
      }),
    },
  };
}

function responseSequence(bodies: Array<Record<string, unknown>>) {
  return vi.fn(async () => {
    const body = bodies.shift();
    if (!body) throw new Error('No synthetic Shopify response left');
    return jsonResponse(body);
  });
}

function throttledResponse() {
  return {
    errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
    extensions: {
      cost: {
        requestedQueryCost: 100,
        throttleStatus: { currentlyAvailable: 0, restoreRate: 100 },
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readVariables(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
  const body = JSON.parse(init.body) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected object request body');
  const variables = (body as Record<string, unknown>).variables;
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('Expected variables object');
  return variables as Record<string, unknown>;
}
