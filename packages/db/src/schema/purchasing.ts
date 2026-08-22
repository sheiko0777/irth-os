import { pgTable, uuid, timestamp, text, numeric, bigint, integer } from 'drizzle-orm/pg-core';
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
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  totalAmountMinor: bigint('total_amount_minor', { mode: 'number' }),
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
  unitCost: numeric('unit_cost', { precision: 12, scale: 2 }),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'number' }),
  receivedQuantity: integer('received_quantity').default(0),
});
