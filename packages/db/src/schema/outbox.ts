import { pgTable, text, timestamp, boolean, integer, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const outboxEvents = pgTable('outbox_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    processed: boolean('processed').default(false).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
});
