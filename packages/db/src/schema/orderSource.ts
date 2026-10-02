import { bigint, char, foreignKey, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { orders, organizations } from '../schema';

// Mirrors migration 0086 (orders v2): the provider's child records of a
// promoted order, one row per (order_id, source_id). Same-org composite FK onto
// orders(id, org_id). The RLS policies live in the migration.

export const orderSourceTransactions = pgTable('order_source_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  orderId: uuid('order_id').notNull(),
  sourceId: text('source_id').notNull(),
  kind: text('kind'),
  status: text('status'),
  gateway: text('gateway'),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }),
  currency: char('currency', { length: 3 }),
  parentSourceId: text('parent_source_id'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: 'order_source_transactions_order_same_org_fk', columns: [t.orderId, t.orgId], foreignColumns: [orders.id, orders.orgId] }),
  unique('order_source_transactions_order_source_key').on(t.orderId, t.sourceId),
]);

export const orderSourceRefunds = pgTable('order_source_refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  orderId: uuid('order_id').notNull(),
  sourceId: text('source_id').notNull(),
  note: text('note'),
  totalMinor: bigint('total_minor', { mode: 'bigint' }),
  lineItems: jsonb('line_items'),
  transactionSourceIds: text('transaction_source_ids').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: 'order_source_refunds_order_same_org_fk', columns: [t.orderId, t.orgId], foreignColumns: [orders.id, orders.orgId] }),
  unique('order_source_refunds_order_source_key').on(t.orderId, t.sourceId),
]);

export const orderSourceFulfillments = pgTable('order_source_fulfillments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  orderId: uuid('order_id').notNull(),
  sourceId: text('source_id').notNull(),
  status: text('status'),
  tracking: jsonb('tracking'),
  lineItems: jsonb('line_items'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: 'order_source_fulfillments_order_same_org_fk', columns: [t.orderId, t.orgId], foreignColumns: [orders.id, orders.orgId] }),
  unique('order_source_fulfillments_order_source_key').on(t.orderId, t.sourceId),
]);
