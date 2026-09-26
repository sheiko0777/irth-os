import { pgTable, uuid, timestamp, text, bigint, char, integer, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  // 0079: the supplier's side, set from the supplier portal. A proposed date
  // waits for the buyer; expected_delivery_at is the agreed one.
  supplierStatus: text('supplier_status').$type<'pending' | 'confirmed' | 'date_proposed'>().notNull().default('pending'),
  expectedDeliveryAt: timestamp('expected_delivery_at'),
  proposedDeliveryAt: timestamp('proposed_delivery_at'),
  supplierNote: text('supplier_note'),
  supplierRespondedAt: timestamp('supplier_responded_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  // Per tenant (0035). Was unconstrained entirely, so the count(*)+1
  // generator's collisions were not merely likely — nothing rejected them,
  // and two documents legitimately shared a number.
  uniqueIndex('purchase_orders_org_po_number_idx').on(table.orgId, table.poNumber),
]);

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Added in 0030. A composite FK on (po_id, org_id) -> purchase_orders(id,
  // org_id) makes a line whose org disagrees with its parent's unrepresentable,
  // so this column cannot drift into showing a row to the wrong tenant.
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productName: text('product_name').notNull(),
  variantName: text('variant_name'),
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(1),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'bigint' }),
  receivedQuantity: integer('received_quantity').default(0),
});

// ---------------------------------------------------------------------------
// 0079 (PR-3): shipping notices from the supplier portal, and payments to
// suppliers. Both append-only; the composite same-org FKs and the supplier
// policies live in the migration.
// ---------------------------------------------------------------------------

export const purchaseOrderShipments = pgTable('purchase_order_shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  poId: uuid('po_id').notNull(),
  shippedAt: timestamp('shipped_at').notNull(),
  expectedArrivalAt: timestamp('expected_arrival_at'),
  reference: text('reference'),
  note: text('note'),
  createdByMemberId: uuid('created_by_member_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('purchase_order_shipments_org_po_idx').on(t.orgId, t.poId)]);

export const purchaseOrderShipmentItems = pgTable('purchase_order_shipment_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  shipmentId: uuid('shipment_id').notNull(),
  poItemId: uuid('po_item_id').notNull(),
  quantity: integer('quantity').notNull(),
}, (t) => [
  index('purchase_order_shipment_items_org_shipment_idx').on(t.orgId, t.shipmentId),
  check('purchase_order_shipment_items_quantity_check', sql`${t.quantity} > 0`),
]);

export const supplierPayments = pgTable('supplier_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  supplierId: uuid('supplier_id').notNull(),
  poId: uuid('po_id'),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  method: text('method').$type<'cash' | 'bank'>().notNull(),
  reference: text('reference'),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
  journalEntryId: uuid('journal_entry_id').notNull(),
  createdBy: text('created_by'),
}, (t) => [
  index('supplier_payments_org_supplier_idx').on(t.orgId, t.supplierId),
  check('supplier_payments_amount_check', sql`${t.amountMinor} > 0`),
]);
