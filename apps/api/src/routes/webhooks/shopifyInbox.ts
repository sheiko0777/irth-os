import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import {
  emitOutboxEvent,
  inboundDeliveries,
  isUniqueViolation,
  shopifyConnections,
  withOrgContext,
} from '@irth/db';
import { getDb } from '../../db';
import { verifyShopifyWebhook } from '../../middlewares/verifyShopifyWebhook';
import { hashOpaque } from '../../services/shopifyConnection';

const shopifyInboxRoute = new Hono();

const TOPIC_BY_ROUTE: Record<string, string> = {
  '/orders-create': 'orders/create',
  '/orders-updated': 'orders/updated',
  '/orders-edited': 'orders/edited',
  '/orders-paid': 'orders/paid',
  '/orders-cancelled': 'orders/cancelled',
  '/orders-fulfilled': 'orders/fulfilled',
  '/orders-partially-fulfilled': 'orders/partially_fulfilled',
  '/refunds-create': 'refunds/create',
  '/fulfillments-create': 'fulfillments/create',
  '/fulfillments-update': 'fulfillments/update',
  '/order-transactions-create': 'order_transactions/create',
};

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type ResolvedConnection = {
  orgId: string;
  connectionId: string;
  shopDomain: string;
};

type InboxClaim =
  | { kind: 'new'; deliveryId: string }
  | { kind: 'retry'; deliveryId: string }
  | { kind: 'processed' };

async function receiveShopifyInboxDelivery(c: Context, topic: string): Promise<Response> {
  const db = getDb();
  const resolved = await resolveWebhookConnection(c, db, topic);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);

  // Tenant context for the write: inbound_deliveries and outbox are under
  // FORCE RLS, so the inbox row and its outbox event must be written inside
  // withOrgContext (same transaction, app.org_id set), not a bare transaction.
  const claim = await withOrgContext(db, resolved.orgId, async (tx) => {
    const delivery = await claimInboxDelivery(tx, resolved, c, topic);
    if (delivery.kind === 'processed') return delivery;

    await emitOutboxEvent(tx, {
      orgId: resolved.orgId,
      eventType: 'inbound.delivery.process',
      payload: { orgId: resolved.orgId, deliveryId: delivery.deliveryId },
    });
    await tx.update(shopifyConnections)
      .set({ lastWebhookAt: new Date() })
      .where(eq(shopifyConnections.id, resolved.connectionId));
    return delivery;
  });

  if (claim.kind === 'processed') {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }
  return c.json({ data: { accepted: true, deliveryId: claim.deliveryId }, error: null, meta: null });
}

async function resolveWebhookConnection(c: Context, db: Db, topic: string): Promise<ResolvedConnection | null> {
  const shopDomain = c.req.header('x-shopify-shop-domain')?.toLowerCase().trim();
  if (!shopDomain) {
    console.warn('shopify_webhook.no_matching_connection', {
      topic,
      reason: 'missing_shop_domain',
    });
    return null;
  }

  const [connection] = await db.select({
    id: shopifyConnections.id,
    orgId: shopifyConnections.orgId,
    shopDomain: shopifyConnections.shopDomain,
  }).from(shopifyConnections)
    .where(and(eq(shopifyConnections.shopDomain, shopDomain), eq(shopifyConnections.status, 'active')));

  if (!connection) {
    console.warn('shopify_webhook.no_matching_connection', {
      topic,
      shopDomainHash: hashOpaque(shopDomain),
    });
    return null;
  }

  return { orgId: connection.orgId, connectionId: connection.id, shopDomain: connection.shopDomain };
}

async function claimInboxDelivery(tx: Tx, resolved: ResolvedConnection, c: Context, topic: string): Promise<InboxClaim> {
  const deliveryKey = c.req.header('x-shopify-webhook-id');
  if (!deliveryKey) throw new Error('Shopify webhook delivery missing x-shopify-webhook-id');

  const deliveryId = crypto.randomUUID();
  const rawBody = rawWebhookBytes(c);
  const headers = shopifyEvidenceHeaders(c.req.header());

  try {
    const inserted = await tx.insert(inboundDeliveries).values({
      id: deliveryId,
      orgId: resolved.orgId,
      provider: 'shopify',
      connectionId: resolved.connectionId,
      deliveryKey,
      topic,
      rawBody,
      headers,
      bodySha256: await sha256Hex(rawBody),
      apiVersion: headers['x-shopify-api-version'] ?? null,
      eventId: headers['x-shopify-event-id'] ?? null,
      triggeredAt: parseTimestamp(headers['x-shopify-triggered-at']),
      payload: parseJsonPayload(c.get('rawBody')),
      status: 'received',
    }).onConflictDoNothing().returning({ id: inboundDeliveries.id });

    if (inserted[0]?.id) return { kind: 'new', deliveryId: inserted[0].id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const [existing] = await tx.select({ id: inboundDeliveries.id, status: inboundDeliveries.status })
    .from(inboundDeliveries)
    .where(and(
      eq(inboundDeliveries.provider, 'shopify'),
      eq(inboundDeliveries.connectionId, resolved.connectionId),
      eq(inboundDeliveries.deliveryKey, deliveryKey),
    ));

  if (existing?.status === 'processed') return { kind: 'processed' };
  if (!existing?.id) throw new Error('Shopify webhook delivery conflict could not be reloaded');
  return { kind: 'retry', deliveryId: existing.id };
}

function rawWebhookBytes(c: Context): Uint8Array {
  const rawBytes: unknown = c.get('rawBytes');
  if (rawBytes instanceof Uint8Array) return rawBytes;

  const rawBody: unknown = c.get('rawBody');
  if (typeof rawBody === 'string') return new TextEncoder().encode(rawBody);
  throw new Error('raw webhook bytes missing');
}

function parseJsonPayload(rawBody: unknown): object | null {
  if (typeof rawBody !== 'string') return null;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Only Shopify evidence headers are kept; no cookies, auth, or raw body in logs. */
function shopifyEvidenceHeaders(all: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(all ?? {})) {
    const key = name.toLowerCase();
    if (key.startsWith('x-shopify-')) out[key] = value;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

for (const [route, topic] of Object.entries(TOPIC_BY_ROUTE)) {
  shopifyInboxRoute.post(route, verifyShopifyWebhook(), (c) => receiveShopifyInboxDelivery(c, topic));
}

export { shopifyInboxRoute, receiveShopifyInboxDelivery };
