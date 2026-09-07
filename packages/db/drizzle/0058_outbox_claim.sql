ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;
