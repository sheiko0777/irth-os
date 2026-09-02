import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

/** A named policy a company can assign to one or more staff members. */
export const accessProfiles = pgTable('access_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  permissions: jsonb('permissions').notNull().default({}),
  screens: text('screens').array().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  orgNameUnique: uniqueIndex('access_profiles_org_name_idx').on(table.orgId, table.name),
}));
