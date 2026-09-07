ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;
