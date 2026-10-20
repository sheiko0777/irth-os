import { boolean } from "drizzle-orm/pg-core";
import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, text, integer, bigint, char, uniqueIndex, unique, index, foreignKey, check, primaryKey } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';
import { brands } from './dimensions';
import { shopifyConnections } from './shopify';

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  // Shopify counterpart's GID once linked (inbound webhook, or pushed from
  // the dashboard) — see migration 0041.
  shopifyCustomerId: text('shopify_customer_id'),
  marketingConsent: boolean('marketing_consent').notNull().default(true),
  loyaltyPoints: integer('loyalty_points').notNull().default(0),
  totalOrders: integer('total_orders').notNull().default(0),
  totalSpentMinor: bigint('total_spent_minor', { mode: 'bigint' }).notNull().default(0n),
  notes: text('notes'),
  // 0078. The sales rep (org_members.id) who looks after this customer. A
  // sales rep sees only their own (customers_sales_rep_scope).
  salesRepMemberId: uuid('sales_rep_member_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  orgShopifyCustomerIdIdx: uniqueIndex('customers_org_id_shopify_customer_id_idx').on(table.orgId, table.shopifyCustomerId),
  // 0087: target of the composite same-org FKs below.
  idOrgUq: unique('customers_id_org_id_key').on(table.id, table.orgId),
}));

// Mirrors migration 0087 (DM-06). RLS policies and the customer_merges
// append-only trigger live in the migration.

export const CUSTOMER_IDENTITY_KINDS = ['shopify', 'woocommerce', 'email', 'phone', 'whatsapp', 'instagram'] as const;
export type CustomerIdentityKind = (typeof CUSTOMER_IDENTITY_KINDS)[number];

export const customerIdentities = pgTable('customer_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  customerId: uuid('customer_id').notNull(),
  // CX-12 repoints this to the composite connections(id, org_id).
  connectionId: uuid('connection_id').references(() => shopifyConnections.id),
  kind: text('kind').notNull().$type<CustomerIdentityKind>(),
  externalId: text('external_id').notNull(),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: 'customer_identities_customer_same_org_fk', columns: [t.customerId, t.orgId], foreignColumns: [customers.id, customers.orgId] }),
  check('customer_identities_kind_check', sql`${t.kind} IN ('shopify', 'woocommerce', 'email', 'phone', 'whatsapp', 'instagram')`),
  check('customer_identities_external_id_check', sql`length(btrim(${t.externalId})) > 0`),
  // NULLS NOT DISTINCT: connection-less email/phone identities dedupe per org.
  unique('customer_identities_key_uq').on(t.orgId, t.kind, t.connectionId, t.externalId).nullsNotDistinct(),
  index('customer_identities_customer_idx').on(t.customerId),
]);

export const customerBrandRelationships = pgTable('customer_brand_relationships', {
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  customerId: uuid('customer_id').notNull(),
  brandId: uuid('brand_id').notNull(),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  consentSource: text('consent_source'),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  firstOrderAt: timestamp('first_order_at', { withTimezone: true }),
  lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
  orderCount: integer('order_count').notNull().default(0),
  spentMinor: bigint('spent_minor', { mode: 'bigint' }).notNull().default(0n),
  currency: char('currency', { length: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.customerId, t.brandId] }),
  foreignKey({ name: 'customer_brand_relationships_customer_same_org_fk', columns: [t.customerId, t.orgId], foreignColumns: [customers.id, customers.orgId] }),
  foreignKey({ name: 'customer_brand_relationships_brand_same_org_fk', columns: [t.brandId, t.orgId], foreignColumns: [brands.id, brands.orgId] }),
  check('customer_brand_relationships_order_count_check', sql`${t.orderCount} >= 0`),
  index('customer_brand_relationships_org_brand_idx').on(t.orgId, t.brandId),
]);

// Append-only: irth_app has SELECT/INSERT only and a trigger refuses
// UPDATE/DELETE for every role.
export const customerMerges = pgTable('customer_merges', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  winnerId: uuid('winner_id').notNull(),
  loserId: uuid('loser_id').notNull(),
  mergedBy: text('merged_by'),
  mergedAt: timestamp('merged_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
}, (t) => [
  foreignKey({ name: 'customer_merges_winner_same_org_fk', columns: [t.winnerId, t.orgId], foreignColumns: [customers.id, customers.orgId] }),
  foreignKey({ name: 'customer_merges_loser_same_org_fk', columns: [t.loserId, t.orgId], foreignColumns: [customers.id, customers.orgId] }),
  check('customer_merges_distinct_check', sql`${t.winnerId} <> ${t.loserId}`),
  index('customer_merges_org_merged_at_idx').on(t.orgId, t.mergedAt),
]);

export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  type: text('type').notNull(), // 'earn' | 'redeem' | 'adjust'
  points: integer('points').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  note: text('note'),
  referenceId: uuid('reference_id'),
  createdAt: timestamp('created_at').defaultNow(),
});
