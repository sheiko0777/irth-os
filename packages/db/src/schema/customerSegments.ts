import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const customerSegments = pgTable('customer_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#B0885E'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerSegmentMembers = pgTable('customer_segment_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  segmentId: uuid('segment_id').notNull().references(() => customerSegments.id, { onDelete: 'cascade' }),
  // customer_id has no FK in the database (checked every migration, 0023
  // through the current one) - a stray uncommitted edit here once added
  // .references(() => customers.id), which was a false claim about a
  // constraint that does not exist. Left as a bare column deliberately.
  customerId: uuid('customer_id').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});
