import { pgTable, uuid, timestamp, text, bigint, char, integer } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  poNumber: text('po_number').notNull(),
  status: text('status').notNull().default('draft'), // draft, ordered, partial, received, cancelled
  notes: text('notes'),
  totalAmountMinor: bigint('total_amount_minor', { mode: 'bigint' }),
  // A supplier may genuinely invoice in a foreign currency, so this document
  // carries its own denomination rather than assuming the org's.
  currency: char('currency', { length: 3 }).notNull().default('EGP'),
  orderedAt: timestamp('ordered_at'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productName: text('product_name').notNull(),
  variantName: text('variant_name'),
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(1),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'bigint' }),
  receivedQuantity: integer('received_quantity').default(0),
});
