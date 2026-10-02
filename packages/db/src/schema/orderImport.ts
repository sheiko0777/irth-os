import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orders, organizations } from '../schema';
import { inboundDeliveries } from './inbound';
import { shopifyConnections } from './shopify';

// Mirrors migration 0085 (OR-03): one hydrated provider order version awaiting
// validation and promotion. Blocked rows are the "Import blocked" queue;
// promotion into orders happens in OR-10. The RLS policy lives in the migration.

export const ORDER_IMPORT_CANDIDATE_STATUSES = ['hydrating', 'blocked', 'promoted', 'superseded', 'discarded'] as const;
export type OrderImportCandidateStatus = (typeof ORDER_IMPORT_CANDIDATE_STATUSES)[number];

export const orderImportCandidates = pgTable('order_import_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  // CX-12 repoints this to the composite connections(id, org_id).
  connectionId: uuid('connection_id').references(() => shopifyConnections.id),
  provider: text('provider').notNull().default('shopify'),
  sourceOrderId: text('source_order_id').notNull(),
  sourceOrderNumber: text('source_order_number'),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  inboundDeliveryId: uuid('inbound_delivery_id').references(() => inboundDeliveries.id),
  status: text('status').notNull().default('hydrating').$type<OrderImportCandidateStatus>(),
  // CandidateOrder (packages/domain, OR-02); null until hydration finishes.
  normalized: jsonb('normalized'),
  sections: jsonb('sections').notNull().default({}).$type<Record<string, unknown>>(),
  blockers: jsonb('blockers').notNull().default([]).$type<unknown[]>(),
  lineCount: integer('line_count'),
  apiVersion: text('api_version'),
  connectorVersion: text('connector_version'),
  promotedOrderId: uuid('promoted_order_id'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: 'order_import_candidates_promoted_order_same_org_fk',
    columns: [t.promotedOrderId, t.orgId],
    foreignColumns: [orders.id, orders.orgId],
  }),
  uniqueIndex('order_import_candidates_source_version_idx').on(t.provider, t.connectionId, t.sourceOrderId, t.sourceUpdatedAt),
  index('order_import_candidates_org_status_updated_idx').on(t.orgId, t.status, t.updatedAt),
  index('order_import_candidates_inbound_delivery_idx').on(t.inboundDeliveryId),
  // 0086: target of orders' same-org candidate FKs.
  unique('order_import_candidates_id_org_id_key').on(t.id, t.orgId),
  check('order_import_candidates_provider_check', sql`${t.provider} ~ '^[a-z][a-z0-9_]{1,40}$'`),
  check('order_import_candidates_status_check', sql`${t.status} IN ('hydrating', 'blocked', 'promoted', 'superseded', 'discarded')`),
  check('order_import_candidates_sections_check', sql`jsonb_typeof(${t.sections}) = 'object'`),
  check('order_import_candidates_blockers_check', sql`jsonb_typeof(${t.blockers}) = 'array'`),
  check('order_import_candidates_line_count_check', sql`${t.lineCount} IS NULL OR ${t.lineCount} >= 0`),
  check('order_import_candidates_promoted_has_order_check', sql`${t.status} <> 'promoted' OR ${t.promotedOrderId} IS NOT NULL`),
]);
