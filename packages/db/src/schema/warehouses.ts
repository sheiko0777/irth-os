import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, productVariants } from '../schema';

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orgCodeUnique: uniqueIndex('warehouses_org_code_idx').on(table.orgId, table.code),
}));

export const inventoryLots = pgTable('inventory_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id),
  lotNumber: text('lot_number').notNull(),
  expiresOn: date('expires_on', { mode: 'date' }),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
  status: text('status').notNull().default('available'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  orgWarehouseVariantLotUnique: uniqueIndex('inventory_lots_org_warehouse_variant_lot_idx')
    .on(table.orgId, table.warehouseId, table.variantId, table.lotNumber),
  fefoLookup: index('inventory_lots_fefo_idx').on(table.orgId, table.variantId, table.status, table.expiresOn),
}));

export const inventoryLotBalances = pgTable('inventory_lot_balances', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  lotId: uuid('lot_id').notNull().references(() => inventoryLots.id),
  quantity: integer('quantity').notNull().default(0),
  reservedQuantity: integer('reserved_quantity').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  lotUnique: uniqueIndex('inventory_lot_balances_lot_idx').on(table.lotId),
  validQuantities: check('inventory_lot_balances_quantities_check', sql`${table.quantity} >= 0 AND ${table.reservedQuantity} >= 0 AND ${table.reservedQuantity} <= ${table.quantity}`),
}));

