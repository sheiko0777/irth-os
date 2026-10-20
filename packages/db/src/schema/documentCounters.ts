import { pgTable, uuid, text, bigint, timestamp, primaryKey, foreignKey } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';
import { legalEntities } from './dimensions';

/**
 * Per-tenant, per-legal-entity, per-kind counters for human-facing document
 * numbers.
 *
 * Replaces `count(*) + 1`, which was read-then-write and therefore raced: at
 * READ COMMITTED two concurrent creates both observed N and both built N+1.
 * See migration 0036 for why this is a counter row rather than a Postgres
 * SEQUENCE (sequences are deliberately not gapless, and are not per-tenant).
 * 0081 (DM-04) keyed it per legal entity: each entity runs its own series.
 *
 * Allocate through `nextDocumentNumber` — never read `lastValue` and write it
 * back, which reintroduces exactly the race this replaced.
 */
export const orgDocumentCounters = pgTable('org_document_counters', {
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  /** The issuing legal entity (0081); same-org composite FK below. */
  legalEntityId: uuid('legal_entity_id').notNull(),
  /** See DocumentKind. */
  kind: text('kind').notNull(),
  /** The number most recently handed out. Starts at 0, so the first is 1. */
  lastValue: bigint('last_value', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'org_document_counters_pkey', columns: [t.orgId, t.legalEntityId, t.kind] }),
  foreignKey({ name: 'org_document_counters_entity_same_org_fk', columns: [t.legalEntityId, t.orgId], foreignColumns: [legalEntities.id, legalEntities.orgId] }),
]);
