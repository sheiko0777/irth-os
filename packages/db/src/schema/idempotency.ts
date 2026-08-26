import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

/**
 * Records that a given (tenant, operation, key) has been attempted, and what it
 * returned — so a retry replays the first response instead of applying twice.
 *
 * Claimed through `withIdempotency`. See migration 0037 for why the row is
 * inserted `in_progress` BEFORE the work rather than written after it.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  /** Caller-supplied. Only the caller can distinguish a retry from a second intent. */
  key: text('key').notNull(),
  /** The procedure name. One key under two operations is two intents. */
  operation: text('operation').notNull(),
  /** Hash of the request. A key reused with different input is a client bug, not a retry. */
  requestFingerprint: text('request_fingerprint').notNull(),
  state: text('state', { enum: ['in_progress', 'completed'] }).notNull().default('in_progress'),
  response: jsonb('response'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  uniqueIndex('idempotency_keys_org_operation_key_idx')
    .on(table.orgId, table.operation, table.key),
  index('idempotency_keys_created_at_idx').on(table.createdAt),
]);
