-- 0061: Add campaign dispatch structures

-- 1. Extend ENUMs safely
ALTER TYPE "campaign_status" ADD VALUE IF NOT EXISTS 'cancelled';
--> statement-breakpoint

DO $$ BEGIN
    CREATE TYPE "campaign_recipient_status" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'skipped_no_consent', 'skipped_unsupported_channel', 'skipped_cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 2. Add marketing consent
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "marketing_consent" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- 3. Create campaign_recipients
CREATE TABLE IF NOT EXISTS "campaign_recipients" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
    "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
    "customer_id" uuid NOT NULL,
    "channel" "campaign_channel" NOT NULL,
    "status" "campaign_recipient_status" NOT NULL DEFAULT 'pending',
    "provider_message_id" text,
    "error" text,
    "sent_at" timestamp,
    "delivered_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- 4. Enable and enforce RLS (matching exact pattern from 0055 and 0057)
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "campaign_recipients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS campaign_recipients_tenant_isolation ON campaign_recipients;
--> statement-breakpoint

CREATE POLICY campaign_recipients_tenant_isolation ON campaign_recipients
    USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
    WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_recipients" TO irth_app;
