import { pgTable, uuid, timestamp, text, integer, bigint, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

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
  loyaltyPoints: integer('loyalty_points').notNull().default(0),
  totalOrders: integer('total_orders').notNull().default(0),
  totalSpentMinor: bigint('total_spent_minor', { mode: 'bigint' }).notNull().default(0n),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  orgShopifyCustomerIdIdx: uniqueIndex('customers_org_id_shopify_customer_id_idx').on(table.orgId, table.shopifyCustomerId),
}));

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
