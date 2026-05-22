import { pgTable, uuid, text, decimal, boolean, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations, orders } from '../schema';

export const courierShipments = pgTable('courier_shipments', {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    orderId: uuid('order_id').notNull().references(() => orders.id).unique(),
    courier: text('courier').notNull(), // 'bosta' | 'aramex'
    trackingNumber: text('tracking_number'),
    courierStatus: text('courier_status').notNull().default('created'), // created/picked_up/in_transit/delivered/returned/failed
    codAmount: decimal('cod_amount', { precision: 12, scale: 2 }),
    codCollected: boolean('cod_collected').notNull().default(false),
    codRemitted: boolean('cod_remitted').notNull().default(false),
    remittanceId: text('remittance_id'),
    remittanceDate: timestamp('remittance_date'),
    webhookEvents: jsonb('webhook_events').notNull().default([]).$type<unknown[]>(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        orgIdIdx: index('courier_shipments_org_id_idx').on(table.orgId),
        orderIdIdx: index('courier_shipments_order_id_idx').on(table.orderId),
    };
});

export const courierRemittances = pgTable('courier_remittances', {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    courier: text('courier').notNull(),
    remittanceReference: text('remittance_reference').notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    shipmentCount: integer('shipment_count').notNull().default(0),
    status: text('status').notNull().default('pending'), // pending/received/reconciled
    expectedDate: timestamp('expected_date'),
    receivedDate: timestamp('received_date'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        orgIdIdx: index('courier_remittances_org_id_idx').on(table.orgId),
        courierOrgIdIdx: index('courier_remittances_courier_org_id_idx').on(table.courier, table.orgId),
    };
});
