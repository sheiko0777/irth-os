import { pgTable, uuid, timestamp, text, integer, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from '../schema';

export const campaignStatusEnum = pgEnum('campaign_status', ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled']);
export const campaignChannelEnum = pgEnum('campaign_channel', ['whatsapp', 'sms', 'email']);
export const campaignSegmentEnum = pgEnum('campaign_segment', ['all', 'vip', 'inactive', 'new', 'custom']);
export const campaignRecipientStatusEnum = pgEnum('campaign_recipient_status', ['pending', 'sent', 'delivered', 'failed', 'skipped_no_consent', 'skipped_unsupported_channel', 'skipped_cancelled']);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  message: text("message").notNull(),
  channel: campaignChannelEnum("channel").notNull().default('whatsapp'),
  status: campaignStatusEnum("status").notNull().default('draft'),
  targetSegment: campaignSegmentEnum("target_segment").notNull().default('all'),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const campaignRecipients = pgTable("campaign_recipients", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  // No FK to `customers` — same deliberate choice as
  // `customerSegmentMembers.customerId` (schema/customerSegments.ts):
  // avoids a cross-file schema import cycle between campaigns and customers.
  customerId: uuid("customer_id").notNull(),
  channel: campaignChannelEnum("channel").notNull(),
  status: campaignRecipientStatusEnum("status").notNull().default('pending'),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
