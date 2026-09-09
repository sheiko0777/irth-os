import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('upsertShopifyProduct — first-push idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SHOPIFY_SHOP_DOMAIN = 'test.myshopify.com';
    process.env.SHOPIFY_APP_CLIENT_ID = 'client';
    process.env.SHOPIFY_APP_CLIENT_SECRET = 'secret';
  });

  it('reuses a deterministic handle after a post-create/pre-commit retry', async () => {
    const productsByHandle = new Map<string, string>();
    let creates = 0;
    const graphqlBodies: Array<{ variables: { identifier: { handle?: string }; input: { handle?: string } } }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/admin/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { variables: { identifier: { handle?: string }; input: { handle?: string } } };
      graphqlBodies.push(body);
      const handle = body.variables.identifier.handle;
      if (!handle) throw new Error('expected handle identifier for first push');
      let id = productsByHandle.get(handle);
      if (!id) {
        id = 'gid://shopify/Product/1';
        productsByHandle.set(handle, id);
        creates += 1;
      }
      return new Response(JSON.stringify({ data: { productSet: {
        product: { id, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', sku: 'SKU-1' }] } },
        userErrors: [],
      } } }), { status: 200 });
    }));

    const { upsertShopifyProduct } = await import('../services/shopify');
    const input = {
      localProductId: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
      title: 'Product',
      status: 'ACTIVE' as const,
      variants: [{ sku: 'SKU-1', priceMinor: 1000n, currency: 'EGP' }],
    };

    await upsertShopifyProduct(input); // returned ID is deliberately not persisted
    await upsertShopifyProduct(input);

    expect(creates).toBe(1);
    expect(graphqlBodies).toHaveLength(2);
    expect(graphqlBodies[0]?.variables.identifier).toEqual(graphqlBodies[1]?.variables.identifier);
    expect(graphqlBodies[0]?.variables.input.handle).toBe('irth-a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});
