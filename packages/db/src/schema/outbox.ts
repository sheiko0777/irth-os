import { pgTable, text, timestamp, boolean, integer, uuid, index } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const outboxEvents = pgTable('outbox_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    processed: boolean('processed').default(false).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    claimedAt: timestamp('claimed_at'),
    nextRetryAt: timestamp('next_retry_at'),
});

/**
 * Where an `outbox_events` row goes once it exhausts the claim query's
 * attempts<5 ceiling (see processOutbox/recordEventFailure in
 * apps/api/src/workers/outboxWorker.ts) -- for every event type, not just
 * campaign.recipient.send (which already has its own domain-level failure
 * marking on the recipient row). Without this, a permanently-stuck event
 * just sits in outbox_events forever: processed=false, excluded from every
 * future claim, and invisible.
 *
 * RLS-protected like every other org_id table (see the migration's own
 * comment, and rlsCoverage.test.ts) -- the worker's own connection still
 * sees every org's rows because it runs as the owning role, not through a
 * tenant-scoped `SET LOCAL ROLE irth_app` session.
 *
 * `replayedAt`/`replayedBy` are reserved for a future re-queue action --
 * not read or written by anything yet.
 */
export const outboxDeadLetters = pgTable(
    'outbox_dead_letters',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orgId: uuid('org_id').notNull().references(() => organizations.id),
        eventType: text('event_type').notNull(),
        payload: text('payload').notNull(),
        attempts: integer('attempts').notNull(),
        lastError: text('last_error').notNull(),
        failedAt: timestamp('failed_at').defaultNow().notNull(),
        replayedAt: timestamp('replayed_at'),
        replayedBy: text('replayed_by'),
    },
    (table) => [
        index('outbox_dead_letters_org_id_idx').on(table.orgId),
        index('outbox_dead_letters_failed_at_idx').on(table.failedAt),
    ],
);
