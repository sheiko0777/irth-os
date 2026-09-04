import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { InferSelectModel } from 'drizzle-orm';
import { shopifyConnections } from '@irth/db';
import { getEnv } from '../db';
import { minorToDecimalString } from './shopify';

export const SHOPIFY_API_VERSION = '2025-10';
export const SHOPIFY_SCOPES = [
  'read_products', 'write_products', 'read_inventory', 'write_inventory',
  'read_orders', 'read_customers', 'read_pixels', 'write_pixels',
].join(',');

type ShopifyConnection = InferSelectModel<typeof shopifyConnections>;

function envVar(key: string): string | undefined {
  return (getEnv()?.[key] as string | undefined) ?? process.env[key];
}

async function aesKey(usages: Array<'encrypt' | 'decrypt'>): Promise<CryptoKey> {
  const encoded = envVar('SHOPIFY_TOKEN_ENCRYPTION_KEY');
  if (!encoded) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY is not configured');
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length !== 32) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, usages);
}

/**
 * AES-256-GCM via the Web Crypto API, not node:crypto's createCipheriv/
 * createDecipheriv -- Cloudflare Workers' nodejs_compat polyfills
 * createHash/createHmac/randomBytes/timingSafeEqual (used elsewhere in this
 * file) but not the Cipher/Decipher classes: every real attempt through this
 * code path failed live with "[unenv] crypto.createCipheriv is not
 * implemented yet!", caught via `wrangler tail` against the deployed Worker
 * (not reproducible locally under Node). Workers provide the standard
 * WebCrypto `crypto.subtle` natively, same as a browser, so that's the real
 * implementation here. WebCrypto's AES-GCM encrypt output is ciphertext+tag
 * already concatenated -- the same on-disk shape the old
 * `Buffer.concat([ciphertext, authTag])` produced -- so the stored
 * `accessTokenCiphertext` format is unchanged.
 */
export async function encryptShopifyToken(token: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(12);
  const key = await aesKey(['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(token, 'utf8'));
  return { ciphertext: Buffer.from(encrypted).toString('base64'), iv: iv.toString('base64') };
}

export async function decryptShopifyToken(connection: Pick<ShopifyConnection, 'accessTokenCiphertext' | 'accessTokenIv'>): Promise<string> {
  const key = await aesKey(['decrypt']);
  const ciphertext = Buffer.from(connection.accessTokenCiphertext, 'base64');
  const iv = Buffer.from(connection.accessTokenIv, 'base64');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return Buffer.from(decrypted).toString('utf8');
}

export function normalizeShopDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : null;
}

export function hashOpaque(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function verifyShopifyOAuthHmac(params: URLSearchParams): boolean {
  const hmac = params.get('hmac');
  const secret = envVar('SHOPIFY_APP_CLIENT_SECRET');
  if (!hmac || !secret) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  const actual = Buffer.from(hmac, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export async function exchangeShopifyAuthorizationCode(shopDomain: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const clientId = envVar('SHOPIFY_APP_CLIENT_ID');
  const clientSecret = envVar('SHOPIFY_APP_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Shopify OAuth credentials are not configured');
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!response.ok) throw new Error(`Shopify token exchange failed (${response.status})`);
  const body = await response.json() as { access_token?: string; scope?: string };
  if (!body.access_token) throw new Error('Shopify token exchange returned no access token');
  return { accessToken: body.access_token, scope: body.scope ?? '' };
}

export async function shopifyGraphQL<T>(connection: Pick<ShopifyConnection, 'shopDomain' | 'accessTokenCiphertext' | 'accessTokenIv'>, query: string, variables?: Record<string, unknown>): Promise<T> {
  const accessToken = await decryptShopifyToken(connection);
  const response = await fetch(`https://${connection.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Shopify Admin API failed (${response.status})`);
  const body = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length || !body.data) throw new Error(body.errors?.map((error) => error.message).join('; ') || 'Shopify returned no data');
  return body.data;
}

export async function listShopifyLocations(connection: ShopifyConnection): Promise<Array<{ id: string; name: string }>> {
  const data = await shopifyGraphQL<{ locations: { nodes: Array<{ id: string; name: string }> } }>(connection, `query { locations(first: 50) { nodes { id name } } }`);
  return data.locations.nodes;
}

export interface ShopifyConnectionProductInput {
  shopifyProductId?: string | null;
  title: string;
  descriptionHtml?: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  variants: Array<{ shopifyVariantId?: string | null; sku: string; priceMinor: bigint; currency: string }>;
}

/**
 * Per-org twin of `services/shopify.ts`'s `upsertShopifyProduct` — same
 * `productSet` mutation, same idempotent-by-id shape, but authenticated with
 * a connection's own decrypted token instead of the legacy global-shop
 * client. `outboxWorker.ts` picks between the two based on whether the
 * pushing org has an active `shopify_connections` row.
 */
export async function upsertShopifyProductForConnection(
  connection: Pick<ShopifyConnection, 'shopDomain' | 'accessTokenCiphertext' | 'accessTokenIv'>,
  input: ShopifyConnectionProductInput,
): Promise<{ shopifyProductId: string; variants: Array<{ sku: string; shopifyVariantId: string }> }> {
  const query = `
    mutation ProductSet($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id variants(first: 100) { nodes { id sku } } }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    input: {
      id: input.shopifyProductId ?? undefined,
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      status: input.status,
      variants: input.variants.map((v) => ({ id: v.shopifyVariantId ?? undefined, sku: v.sku, price: minorToDecimalString(v.priceMinor) })),
    },
  };
  const data = await shopifyGraphQL<{
    productSet: { product: { id: string; variants: { nodes: Array<{ id: string; sku: string }> } } | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(connection, query, variables);
  if (data.productSet.userErrors.length) throw new Error(`productSet failed: ${data.productSet.userErrors.map((e) => e.message).join('; ')}`);
  if (!data.productSet.product) throw new Error('productSet returned no product');
  return {
    shopifyProductId: data.productSet.product.id,
    variants: data.productSet.product.variants.nodes.map((v) => ({ sku: v.sku, shopifyVariantId: v.id })),
  };
}

export async function setConnectionInventoryQuantity(connection: ShopifyConnection, inventoryItemId: string, quantity: number): Promise<void> {
  if (!connection.inventoryLocationId) throw new Error('No Shopify inventory location is selected');
  const data = await shopifyGraphQL<{ inventorySetQuantities: { userErrors: Array<{ message: string }> } }>(connection, `
    mutation SetQuantity($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) { userErrors { message } }
    }
  `, { input: { name: 'available', reason: 'correction', quantities: [{ inventoryItemId, locationId: connection.inventoryLocationId, quantity }] } });
  if (data.inventorySetQuantities.userErrors.length) throw new Error(data.inventorySetQuantities.userErrors.map((error) => error.message).join('; '));
}

/**
 * Explicit topic→route map, not a lossy `toLowerCase().replaceAll('_','-')`
 * derivation — CUSTOMERS_CREATE and CUSTOMERS_UPDATE both need to land on
 * the one real `customers-upsert` route in `webhooks/shopify.ts` (that file
 * has no separate `customers-create`/`customers-update` routes), and a
 * derived name would have silently 404'd every customer webhook for any
 * multi-tenant-connected shop. Kept in sync with
 * `scripts/registerShopifyWebhooks.mjs`'s equivalent map — the two
 * registration paths (this one, automatic per-org from the OAuth callback;
 * that script, one-time manual setup for the legacy single-tenant shop) must
 * agree on route names since both point at the same handler file.
 */
const WEBHOOK_TOPIC_ROUTES: Record<string, string> = {
  ORDERS_CREATE: 'orders-create',
  ORDERS_UPDATED: 'orders-updated',
  ORDERS_CANCELLED: 'orders-cancelled',
  CUSTOMERS_CREATE: 'customers-upsert',
  CUSTOMERS_UPDATE: 'customers-upsert',
  INVENTORY_LEVELS_UPDATE: 'inventory-levels-update',
  APP_UNINSTALLED: 'app-uninstalled',
};

export async function registerShopifyWebhooks(connection: ShopifyConnection, apiBaseUrl: string): Promise<void> {
  const callbackBase = `${apiBaseUrl.replace(/\/$/, '')}/api/webhooks/shopify`;
  for (const [topic, route] of Object.entries(WEBHOOK_TOPIC_ROUTES)) {
    const data = await shopifyGraphQL<{ webhookSubscriptionCreate: { userErrors: Array<{ message: string }> } }>(connection, `
      mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) { userErrors { message } }
      }
    `, { topic, input: { callbackUrl: `${callbackBase}/${route}`, format: 'JSON' } });
    if (data.webhookSubscriptionCreate.userErrors.length) throw new Error(data.webhookSubscriptionCreate.userErrors.map((error) => error.message).join('; '));
  }
}
