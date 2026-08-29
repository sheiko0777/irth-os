import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const shopifyConnections = pgTable('shopify_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  shopDomain: text('shop_domain').notNull(),
  shopId: text('shop_id'),
  accessTokenCiphertext: text('access_token_ciphertext').notNull(),
  accessTokenIv: text('access_token_iv').notNull(),
  scopes: text('scopes').notNull(),
  apiVersion: text('api_version').notNull(),
  inventoryLocationId: text('inventory_location_id'),
  status: text('status').notNull().default('active'),
  pixelIngestionKey: text('pixel_ingestion_key').notNull(),
  installedAt: timestamp('installed_at').notNull().defaultNow(),
  lastSyncAt: timestamp('last_sync_at'),
  lastWebhookAt: timestamp('last_webhook_at'),
  lastError: text('last_error'),
  uninstalledAt: timestamp('uninstalled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orgUnique: uniqueIndex('shopify_connections_org_id_idx').on(table.orgId),
  domainUnique: uniqueIndex('shopify_connections_shop_domain_idx').on(table.shopDomain),
}));

export const shopifyOAuthStates = pgTable('shopify_oauth_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  stateHash: text('state_hash').notNull().unique(),
  shopDomain: text('shop_domain').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const shopifyWebhookDeliveries = pgTable('shopify_webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  connectionId: uuid('connection_id').references(() => shopifyConnections.id),
  webhookId: text('webhook_id').notNull(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('received'),
  error: text('error'),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
}, (table) => ({
  orgReceivedIdx: index('shopify_webhook_deliveries_org_received_idx').on(table.orgId, table.receivedAt),
  deliveryUnique: uniqueIndex('shopify_webhook_deliveries_connection_webhook_idx').on(table.connectionId, table.webhookId),
}));

export const storefrontSessions = pgTable('storefront_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  connectionId: uuid('connection_id').notNull().references(() => shopifyConnections.id),
  clientIdHash: text('client_id_hash').notNull(),
  customerId: uuid('customer_id'),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  landingPath: text('landing_path'),
  referrerHost: text('referrer_host'),
  source: text('source'),
  medium: text('medium'),
}, (table) => ({
  connectionClientUnique: uniqueIndex('storefront_sessions_connection_client_idx').on(table.connectionId, table.clientIdHash),
  orgSeenIdx: index('storefront_sessions_org_seen_idx').on(table.orgId, table.lastSeenAt),
}));

export const storefrontEvents = pgTable('storefront_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  connectionId: uuid('connection_id').notNull().references(() => shopifyConnections.id),
  sessionId: uuid('session_id').notNull().references(() => storefrontSessions.id),
  eventId: text('event_id').notNull(),
  eventName: text('event_name').notNull(),
  occurredAt: timestamp('occurred_at').notNull(),
  path: text('path'),
  productId: text('product_id'),
  variantId: text('variant_id'),
  searchTerm: text('search_term'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  eventUnique: uniqueIndex('storefront_events_connection_event_idx').on(table.connectionId, table.eventId),
  orgOccurredIdx: index('storefront_events_org_occurred_idx').on(table.orgId, table.occurredAt),
}));

export const storefrontDailyMetrics = pgTable('storefront_daily_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  metricDate: timestamp('metric_date').notNull(),
  metric: text('metric').notNull(),
  dimensions: jsonb('dimensions').notNull().default({}),
  value: integer('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orgMetricIdx: uniqueIndex('storefront_daily_metrics_org_date_metric_idx').on(table.orgId, table.metricDate, table.metric),
}));
