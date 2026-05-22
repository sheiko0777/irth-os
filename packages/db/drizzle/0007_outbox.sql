CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "outbox_processed_idx" ON "outbox_events" ("processed");
CREATE INDEX IF NOT EXISTS "outbox_org_id_idx" ON "outbox_events" ("org_id");
