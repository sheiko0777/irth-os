CREATE TABLE IF NOT EXISTS "ai_conversation_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt" text NOT NULL,
  "response" text,
  "tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'success' NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_conversation_logs_org_created_at_idx"
  ON "ai_conversation_logs" ("org_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_conversation_logs_user_created_at_idx"
  ON "ai_conversation_logs" ("user_id", "created_at");--> statement-breakpoint

ALTER TABLE "ai_conversation_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_conversation_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "ai_conversation_logs_tenant_isolation" ON "ai_conversation_logs";--> statement-breakpoint
CREATE POLICY "ai_conversation_logs_tenant_isolation" ON "ai_conversation_logs"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);
