import { Hono } from 'hono';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { can, jsonSafe, shopifyConnections, shopifyOAuthStates, withOrgContext, type Role } from '@irth/db';
import { getDb, getEnv } from '../db';
import { encryptShopifyToken, exchangeShopifyAuthorizationCode, hashOpaque, listShopifyLocations, newOpaqueToken, normalizeShopDomain, registerShopifyWebhooks, SHOPIFY_SCOPES, verifyShopifyOAuthHmac } from '../services/shopifyConnection';
import { requireOrgId } from '../middlewares/requireOrgId';

export const shopifyRoute = new Hono();

function apiBaseUrl(): string {
  return ((getEnv()?.SHOPIFY_APP_URL as string | undefined) ?? process.env.SHOPIFY_APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

function adminBaseUrl(): string {
  return ((getEnv()?.ADMIN_APP_URL as string | undefined) ?? process.env.ADMIN_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

shopifyRoute.get('/connect', requireOrgId(), async (c) => {
  const orgId = c.get('orgId') as string;
  const role = c.get('role') as Role;
  const shopDomain = normalizeShopDomain(c.req.query('shop') ?? '');
  if (!can(role, 'integrations', 'connect')) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
  if (!shopDomain) return c.json({ data: null, error: 'invalid_shop_domain', meta: null }, 400);
  const state = newOpaqueToken();
  await withOrgContext(getDb(), orgId, (tx) => tx.insert(shopifyOAuthStates).values({
    orgId, shopDomain, stateHash: hashOpaque(state), expiresAt: new Date(Date.now() + 10 * 60_000),
  }));
  const clientId = (getEnv()?.SHOPIFY_APP_CLIENT_ID as string | undefined) ?? process.env.SHOPIFY_APP_CLIENT_ID;
  if (!clientId) return c.json({ data: null, error: 'shopify_not_configured', meta: null }, 503);
  const callback = `${apiBaseUrl()}/api/shopify/oauth/callback`;
  const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', SHOPIFY_SCOPES);
  authorizeUrl.searchParams.set('redirect_uri', callback);
  authorizeUrl.searchParams.set('state', state);
  return c.redirect(authorizeUrl.toString());
});

shopifyRoute.get('/oauth/callback', async (c) => {
  const params = new URL(c.req.url).searchParams;
  const shopDomain = normalizeShopDomain(params.get('shop') ?? '');
  const code = params.get('code');
  const state = params.get('state');
  if (!shopDomain || !code || !state || !verifyShopifyOAuthHmac(params)) return c.redirect(`${adminBaseUrl()}/ar/integrations?shopify=invalid_callback`);
  const database = getDb();
  const [oauthState] = await database.select().from(shopifyOAuthStates).where(and(eq(shopifyOAuthStates.stateHash, hashOpaque(state)), eq(shopifyOAuthStates.shopDomain, shopDomain), isNull(shopifyOAuthStates.consumedAt), gt(shopifyOAuthStates.expiresAt, new Date()))).limit(1);
  if (!oauthState) return c.redirect(`${adminBaseUrl()}/ar/integrations?shopify=expired_state`);
  const token = await exchangeShopifyAuthorizationCode(shopDomain, code);
  const sealed = await encryptShopifyToken(token.accessToken);
  const connection = await withOrgContext(database, oauthState.orgId, async (tx) => {
    await tx.update(shopifyOAuthStates).set({ consumedAt: new Date() }).where(eq(shopifyOAuthStates.id, oauthState.id));
    const [row] = await tx.insert(shopifyConnections).values({
      orgId: oauthState.orgId, shopDomain, accessTokenCiphertext: sealed.ciphertext, accessTokenIv: sealed.iv,
      scopes: token.scope, apiVersion: '2025-10', pixelIngestionKey: newOpaqueToken(), status: 'active', updatedAt: new Date(),
    }).onConflictDoUpdate({ target: shopifyConnections.orgId, set: { shopDomain, accessTokenCiphertext: sealed.ciphertext, accessTokenIv: sealed.iv, scopes: token.scope, status: 'active', uninstalledAt: null, lastError: null, updatedAt: new Date() } }).returning();
    return row;
  });
  try {
    await registerShopifyWebhooks(connection, apiBaseUrl());
  } catch (error) {
    await database.update(shopifyConnections).set({ lastError: error instanceof Error ? error.message : String(error) }).where(eq(shopifyConnections.id, connection.id));
  }
  return c.redirect(`${adminBaseUrl()}/ar/integrations?shopify=connected`);
});

shopifyRoute.get('/status', requireOrgId(), async (c) => {
  const orgId = c.get('orgId') as string;
  const role = c.get('role') as Role;
  if (!can(role, 'integrations', 'view')) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
  const [connection] = await getDb().select({ id: shopifyConnections.id, shopDomain: shopifyConnections.shopDomain, inventoryLocationId: shopifyConnections.inventoryLocationId, status: shopifyConnections.status, lastSyncAt: shopifyConnections.lastSyncAt, lastWebhookAt: shopifyConnections.lastWebhookAt, lastError: shopifyConnections.lastError }).from(shopifyConnections).where(eq(shopifyConnections.orgId, orgId)).limit(1);
  return c.json({ data: jsonSafe(connection ?? null), error: null, meta: null });
});

shopifyRoute.get('/locations', requireOrgId(), async (c) => {
  const orgId = c.get('orgId') as string;
  const role = c.get('role') as Role;
  if (!can(role, 'integrations', 'view')) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
  const [connection] = await getDb().select().from(shopifyConnections).where(and(eq(shopifyConnections.orgId, orgId), eq(shopifyConnections.status, 'active'))).limit(1);
  if (!connection) return c.json({ data: null, error: 'not_connected', meta: null }, 404);
  return c.json({ data: jsonSafe(await listShopifyLocations(connection)), error: null, meta: null });
});

shopifyRoute.put('/location', requireOrgId(), async (c) => {
  const orgId = c.get('orgId') as string;
  const role = c.get('role') as Role;
  if (!can(role, 'integrations', 'manage')) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
  const body = await c.req.json<{ inventoryLocationId?: string }>();
  if (!body.inventoryLocationId?.startsWith('gid://shopify/Location/')) return c.json({ data: null, error: 'invalid_location', meta: null }, 400);
  const [connection] = await withOrgContext(getDb(), orgId, (tx) => tx.update(shopifyConnections).set({ inventoryLocationId: body.inventoryLocationId, updatedAt: new Date() }).where(eq(shopifyConnections.orgId, orgId)).returning());
  if (!connection) return c.json({ data: null, error: 'not_connected', meta: null }, 404);
  return c.json({ data: jsonSafe({ inventoryLocationId: connection.inventoryLocationId }), error: null, meta: null });
});
