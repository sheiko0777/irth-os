import { pgTable, text, timestamp, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const orgSettings = pgTable('org_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: text('updated_by'),
}, (table) => ({
  orgIdKeyIdx: uniqueIndex('org_settings_org_id_key_idx').on(table.orgId, table.key),
  orgIdIdx: index('org_settings_org_id_idx').on(table.orgId),
}));
