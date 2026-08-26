import { pgTable, pgEnum, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { organizations, orders, productVariants } from '../schema';
import { inventoryMovements } from './inventory';

export const discrepancyStatusEnum = pgEnum('discrepancy_status', ['open', 'acknowledged', 'resolved']);

/**
 * A Shopify sale that outran available stock. The webhook cannot reject the
 * sale (Shopify is the orders source of truth) - it applies what's on hand,
 * floors quantity at zero, and records the shortfall here for reconciliation.
 * See apps/api/src/routes/webhooks/shopify.ts's orders/create handler.
 */
export const inventoryDiscrepancies = pgTable('inventory_discrepancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id),
  shopifyOrderId: text('shopify_order_id'),
  requestedQuantity: integer('requested_quantity').notNull(),
  appliedQuantity: integer('applied_quantity').notNull(),
  shortfallQuantity: integer('shortfall_quantity').notNull(),
  movementId: uuid('movement_id').references(() => inventoryMovements.id),
  status: discrepancyStatusEnum('status').notNull().default('open'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index('inventory_discrepancies_org_id_idx').on(table.orgId),
  orgIdStatusIdx: index('inventory_discrepancies_org_id_status_idx').on(table.orgId, table.status),
}));
