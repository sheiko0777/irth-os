import { pgTable, uuid, timestamp, text, jsonb, index } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

export const aiConversationLogs = pgTable('ai_conversation_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  response: text('response'),
  toolCalls: jsonb('tool_calls').notNull().default([]),
  status: text('status').notNull().default('success'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgCreatedAtIdx: index('ai_conversation_logs_org_created_at_idx').on(table.orgId, table.createdAt),
  userCreatedAtIdx: index('ai_conversation_logs_user_created_at_idx').on(table.userId, table.createdAt),
}));
