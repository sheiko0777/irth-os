import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';

export const customerSegments = pgTable('customer_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#B0885E'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerSegmentMembers = pgTable('customer_segment_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  segmentId: uuid('segment_id').notNull().references(() => customerSegments.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});
