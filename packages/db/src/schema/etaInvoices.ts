import { pgTable, text, timestamp, uuid, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';
import { orders } from '../schema';

export const etaInvoices = pgTable('eta_invoices', {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    etaUuid: text('eta_uuid'),
    status: text('status').notNull().default('pending'), // pending/submitted/valid/rejected/cancelled
    submittedAt: timestamp('submitted_at'),
    qrCodeData: text('qr_code_data'),
    longId: text('long_id'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        orgIdIdx: index('eta_invoices_org_id_idx').on(table.orgId),
        orderIdUniqueIdx: uniqueIndex('eta_invoices_order_id_idx').on(table.orderId),
    };
});
