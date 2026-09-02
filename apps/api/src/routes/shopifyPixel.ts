import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { shopifyConnections, storefrontSessions, storefrontEvents, jsonSafe } from '@irth/db';
import { getDb } from '../db';
import { hashOpaque } from '../services/shopifyConnection';

/**
 * Ingestion endpoint for the Shopify Web Pixel (the pixel extension itself —
 * Shopify CLI app-extension scaffolding, Partner Dashboard registration — is
 * explicitly out of scope for this pass; this is the server-side half it
 * would post to once built). Unauthenticated by necessity: a storefront pixel
 * runs in an anonymous shopper's browser, no admin session exists to check.
 * `pixelIngestionKey` (already on every `shopify_connections` row, generated
 * at OAuth-connect time) is the only access control — unguessable per-org
 * token in the URL path, not a query param, so it doesn't end up in referrer
 * headers or access logs the way a query string would.
 */
export const shopifyPixelRoute = new Hono();

interface IncomingPixelEvent {
  eventId: string;
  eventName: string;
  occurredAt: string; // ISO 8601, from the pixel's own clock
  clientId: string; // Shopify's Web Pixels API `analytics.subscribe`'s ctx.analytics client id — anonymous, not a customer id
  path?: string;
  productId?: string;
  variantId?: string;
  searchTerm?: string;
  landingPath?: string;
  referrerHost?: string;
  source?: string;
  medium?: string;
  metadata?: Record<string, unknown>;
}

function isValidEvent(body: unknown): body is IncomingPixelEvent {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.eventId === 'string' && b.eventId.length > 0
    && typeof b.eventName === 'string' && b.eventName.length > 0
    && typeof b.occurredAt === 'string' && !Number.isNaN(Date.parse(b.occurredAt))
    && typeof b.clientId === 'string' && b.clientId.length > 0;
}

shopifyPixelRoute.post('/:ingestionKey', async (c: Context) => {
  const ingestionKey = c.req.param('ingestionKey');
  if (!ingestionKey) return c.json({ data: null, error: 'invalid_ingestion_key', meta: null }, 404);
  const db = getDb();

  const [connection] = await db.select({ id: shopifyConnections.id, orgId: shopifyConnections.orgId })
    .from(shopifyConnections)
    .where(and(eq(shopifyConnections.pixelIngestionKey, ingestionKey), eq(shopifyConnections.status, 'active')));
  // Same shape as an invalid webhook signature: don't distinguish
  // "wrong key" from "connection uninstalled" in the response — nothing a
  // legitimate pixel needs to know, and no reason to help enumerate keys.
  if (!connection) return c.json({ data: null, error: 'invalid_ingestion_key', meta: null }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  }
  if (!isValidEvent(body)) return c.json({ data: null, error: 'invalid_event', meta: null }, 400);

  const clientIdHash = hashOpaque(body.clientId);

  const [session] = await db.insert(storefrontSessions).values({
    orgId: connection.orgId,
    connectionId: connection.id,
    clientIdHash,
    landingPath: body.landingPath ?? body.path ?? null,
    referrerHost: body.referrerHost ?? null,
    source: body.source ?? null,
    medium: body.medium ?? null,
  }).onConflictDoUpdate({
    target: [storefrontSessions.connectionId, storefrontSessions.clientIdHash],
    // Only lastSeenAt moves on a repeat visit — landing/referrer/source/medium
    // describe how the FIRST visit arrived and stay fixed after that,
    // matching the table's own "first_seen_at" naming.
    set: { lastSeenAt: new Date() },
  }).returning({ id: storefrontSessions.id });

  try {
    await db.insert(storefrontEvents).values({
      orgId: connection.orgId,
      connectionId: connection.id,
      sessionId: session.id,
      eventId: body.eventId,
      eventName: body.eventName,
      occurredAt: new Date(body.occurredAt),
      path: body.path ?? null,
      productId: body.productId ?? null,
      variantId: body.variantId ?? null,
      searchTerm: body.searchTerm ?? null,
      metadata: body.metadata ?? {},
    });
  } catch (err) {
    // Unique (connection_id, event_id) — the pixel's own retry/dedup key.
    // A redelivery is success, not an error.
    if ((err as { code?: string }).code === '23505') {
      return c.json({ data: jsonSafe({ alreadyRecorded: true }), error: null, meta: null });
    }
    throw err;
  }

  return c.json({ data: jsonSafe({ recorded: true }), error: null, meta: null }, 201);
});
