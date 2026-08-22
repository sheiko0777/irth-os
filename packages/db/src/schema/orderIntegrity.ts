import { pgTable, uuid, integer, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

/**
 * One row per org. Allocates gapless, race-free, per-org-per-year order
 * sequence numbers via a single atomic UPSERT (see allocateOrderSeq in
 * apps/api/src/routes/orders.ts) instead of the old `count(*) + 1` pattern,
 * which raced under concurrent inserts and reused numbers on conflict.
 */
export const orderNumberCounters = pgTable('order_number_counters', {
  orgId: uuid('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  lastSeq: integer('last_seq').notNull().default(0),
});

/**
 * Idempotency ledger for inbound payment-provider webhooks. A (provider,
 * eventId) row is inserted, inside the same transaction as the state change
 * it authorizes, before that state change is applied — a unique-violation on
 * insert means this event was already processed, so the handler can safely
 * no-op instead of double-confirming an order or double-crediting a refund.
 */
export const paymentWebhookEvents = pgTable('payment_webhook_events', {
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  orderId: uuid('order_id'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.eventId] }),
}));
