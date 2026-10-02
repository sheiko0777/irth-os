import { sql } from 'drizzle-orm';
import { check, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';
import { shopifyConnections } from './shopify';

// Mirrors migration 0084 (OR-01): the one durable inbox for inbound provider
// deliveries (renamed from shopify_webhook_deliveries). raw_body is the exact
// request bytes and the source of truth; payload is the parsed jsonb, kept for
// continuity and nullable.

export const INBOUND_DELIVERY_STATUSES = ['received', 'processing', 'processed', 'failed', 'blocked'] as const;
export type InboundDeliveryStatus = (typeof INBOUND_DELIVERY_STATUSES)[number];

// drizzle-orm 0.45 has no native bytea column. postgres-js serialises any
// Uint8Array as bytea and parses bytea back to a Buffer (a Uint8Array).
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

export const inboundDeliveries = pgTable('inbound_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  provider: text('provider').notNull().default('shopify'),
  // CX-12 repoints this to the composite connections(id, org_id).
  connectionId: uuid('connection_id').references(() => shopifyConnections.id),
  deliveryKey: text('delivery_key').notNull(),
  eventId: text('event_id'),
  topic: text('topic').notNull(),
  rawBody: bytea('raw_body').notNull(),
  headers: jsonb('headers').notNull().default({}).$type<Record<string, string>>(),
  bodySha256: text('body_sha256').notNull(),
  apiVersion: text('api_version'),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }),
  payload: jsonb('payload'),
  status: text('status').notNull().default('received').$type<InboundDeliveryStatus>(),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
  retentionUntil: timestamp('retention_until', { withTimezone: true }).notNull().default(sql`(now() + interval '24 months')`),
}, (t) => [
  index('inbound_deliveries_org_received_idx').on(t.orgId, t.receivedAt),
  uniqueIndex('inbound_deliveries_provider_connection_key_idx').on(t.provider, t.connectionId, t.deliveryKey),
  check('inbound_deliveries_status_check', sql`${t.status} IN ('received', 'processing', 'processed', 'failed', 'blocked')`),
  check('inbound_deliveries_provider_check', sql`${t.provider} ~ '^[a-z][a-z0-9_]{1,40}$'`),
]);
