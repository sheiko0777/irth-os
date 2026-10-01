import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';
import { brands, legalEntities } from './dimensions';

// Mirrors migration 0083 (CX-07). Secrets live only in connection_secrets,
// envelope-encrypted by packages/db/src/secrets.ts; connections.config holds
// non-secret settings only.

export const CONNECTION_FAMILIES = ['storefront', 'courier', 'payment', 'messaging', 'tax'] as const;
export const CONNECTION_STATUSES = ['pending', 'active', 'degraded', 'disabled'] as const;

export const connections = pgTable('connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  provider: text('provider').notNull(),
  family: text('family').notNull().$type<(typeof CONNECTION_FAMILIES)[number]>(),
  name: text('name').notNull(),
  externalAccountId: text('external_account_id'),
  brandId: uuid('brand_id'),
  legalEntityId: uuid('legal_entity_id'),
  status: text('status').notNull().default('pending').$type<(typeof CONNECTION_STATUSES)[number]>(),
  priority: integer('priority').notNull().default(0),
  config: jsonb('config').notNull().default({}).$type<Record<string, unknown>>(),
  health: jsonb('health'),
  lastError: text('last_error'),
  lastHealthAt: timestamp('last_health_at'),
  lastWebhookAt: timestamp('last_webhook_at'),
  disabledAt: timestamp('disabled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('connections_id_org_uq').on(t.id, t.orgId),
  unique('connections_org_provider_account_uq').on(t.orgId, t.provider, t.externalAccountId),
  check('connections_family_check', sql`${t.family} IN ('storefront', 'courier', 'payment', 'messaging', 'tax')`),
  check('connections_status_check', sql`${t.status} IN ('pending', 'active', 'degraded', 'disabled')`),
  check('connections_config_object_check', sql`jsonb_typeof(${t.config}) = 'object'`),
  foreignKey({ name: 'connections_brand_same_org_fk', columns: [t.brandId, t.orgId], foreignColumns: [brands.id, brands.orgId] }),
  foreignKey({ name: 'connections_entity_same_org_fk', columns: [t.legalEntityId, t.orgId], foreignColumns: [legalEntities.id, legalEntities.orgId] }),
  index('connections_org_family_idx').on(t.orgId, t.family, t.priority),
]);

export const connectionSecrets = pgTable('connection_secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  connectionId: uuid('connection_id').notNull(),
  name: text('name').notNull(),
  keyVersion: integer('key_version').notNull(),
  wrappedDek: text('wrapped_dek').notNull(),
  dekIv: text('dek_iv').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  last4: text('last4'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  rotatedAt: timestamp('rotated_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('connection_secrets_connection_name_uq').on(t.connectionId, t.name),
  check('connection_secrets_key_version_check', sql`${t.keyVersion} > 0`),
  foreignKey({
    name: 'connection_secrets_connection_same_org_fk',
    columns: [t.connectionId, t.orgId],
    foreignColumns: [connections.id, connections.orgId],
  }).onDelete('cascade'),
  index('connection_secrets_key_version_idx').on(t.keyVersion),
]);
