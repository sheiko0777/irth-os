import { pgTable, text, timestamp, uuid, bigint, integer, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const orderReturns = pgTable('order_returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  orderId: uuid('order_id').notNull(),
  returnNumber: text('return_number').notNull(), // e.g. RMA-0001
  status: text('status', { enum: ['requested', 'approved', 'rejected', 'received', 'restocked', 'refunded', 'exchanged'] }).notNull().default('requested'),
  reason: text('reason', { enum: ['damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other'] }).notNull(),
  resolutionType: text('resolution_type', { enum: ['refund', 'exchange', 'store_credit', 'none'] }).notNull().default('none'),
  notes: text('notes'),
  adminNotes: text('admin_notes'),
  refundAmountMinor: bigint('refund_amount_minor', { mode: 'bigint' }),
  requestedAt: timestamp('requested_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => sql`now()`),
}, (table) => [
  index('order_returns_org_id_idx').on(table.orgId),
  index('order_returns_order_id_idx').on(table.orderId),
]);

export const returnItems = pgTable('return_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Added in 0030, with a composite FK on (return_id, org_id) so a line can
  // never belong to a different org than the return that owns it.
  orgId: uuid('org_id').notNull(),
  returnId: uuid('return_id').notNull().references(() => orderReturns.id, { onDelete: 'cascade' }),
  orderItemId: uuid('order_item_id'),
  productName: text('product_name').notNull(),
  variantName: text('variant_name'),
  quantity: integer('quantity').notNull().default(1),
  unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }),
  condition: text('condition', { enum: ['new', 'good', 'damaged', 'unknown'] }).default('unknown'),
  restock: boolean('restock').notNull().default(false),
}, (table) => [
  index('return_items_return_id_idx').on(table.returnId),
]);
