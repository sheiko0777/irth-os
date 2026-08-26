import { pgTable, uuid, text, boolean, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const orgFeatureFlags = pgTable('org_feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().unique(),
  plan: text('plan').notNull().default('starter'),
  isActive: boolean('is_active').notNull().default(true),
  enabledScreens: text('enabled_screens').array().notNull().default([]),
  disabledScreens: text('disabled_screens').array().notNull().default([]),
  dashboardWidgets: jsonb('dashboard_widgets').notNull().default([]),
  customRbac: jsonb('custom_rbac').notNull().default({}),
  maxUsers: integer('max_users'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
