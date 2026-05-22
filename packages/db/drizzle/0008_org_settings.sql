CREATE TABLE IF NOT EXISTS "org_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_settings_org_id_key_idx" ON "org_settings" USING btree ("org_id","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_settings_org_id_idx" ON "org_settings" USING btree ("org_id");
