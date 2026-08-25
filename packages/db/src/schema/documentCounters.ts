import { pgTable, uuid, text, bigint, timestamp } from 'drizzle-orm/pg-core';

/**
 * Per-tenant, per-kind counters for human-facing document numbers.
 *
 * Replaces `count(*) + 1`, which was read-then-write and therefore raced: at
 * READ COMMITTED two concurrent creates both observed N and both built N+1.
 * See migration 0036 for why this is a counter row rather than a Postgres
 * SEQUENCE (sequences are deliberately not gapless, and are not per-tenant).
 *
 * Allocate through `nextDocumentNumber` — never read `lastValue` and write it
 * back, which reintroduces exactly the race this replaced.
 */
export const orgDocumentCounters = pgTable('org_document_counters', {
  orgId: uuid('org_id').notNull(),
  /** 'order' | 'return' | 'purchase_order'. See DocumentKind. */
  kind: text('kind').notNull(),
  /** The number most recently handed out. Starts at 0, so the first is 1. */
  lastValue: bigint('last_value', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
