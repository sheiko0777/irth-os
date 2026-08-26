import { pgTable, text, timestamp, uuid, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';
import { orders } from '../schema';

export const etaInvoices = pgTable('eta_invoices', {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    etaUuid: text('eta_uuid'),
    // pending/submitted/valid/rejected/cancelled/error. TEXT, not a pgEnum —
    // see migration 0044's comment on why a CHECK was used instead. The
    // database enforces the CHECK; this column's type does not, so a typo
    // here is a review-time risk this comment exists to reduce.
    status: text('status').notNull().default('pending'),
    submittedAt: timestamp('submitted_at'),
    qrCodeData: text('qr_code_data'),
    longId: text('long_id'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    // Set only on a retryable failure (see packages/domain/src/eta.ts's
    // IssueInvoiceResult). NULL means "not currently cooling down" — either
    // never failed, or failed non-retryably (a human must act, not a timer).
    nextRetryAt: timestamp('next_retry_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => {
    return {
        orgIdIdx: index('eta_invoices_org_id_idx').on(table.orgId),
        orderIdUniqueIdx: uniqueIndex('eta_invoices_order_id_idx').on(table.orderId),
    };
});
