CREATE TYPE "campaign_status" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'failed');
CREATE TYPE "campaign_channel" AS ENUM ('whatsapp', 'sms', 'email');
CREATE TYPE "campaign_segment" AS ENUM ('all', 'vip', 'inactive', 'new', 'custom');

CREATE TABLE "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "message" text NOT NULL,
  "channel" "campaign_channel" DEFAULT 'whatsapp' NOT NULL,
  "status" "campaign_status" DEFAULT 'draft' NOT NULL,
  "target_segment" "campaign_segment" DEFAULT 'all' NOT NULL,
  "scheduled_at" timestamp,
  "sent_at" timestamp,
  "total_recipients" integer DEFAULT 0 NOT NULL,
  "delivered_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);