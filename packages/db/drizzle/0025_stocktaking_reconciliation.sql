ALTER TABLE "stocktaking_sessions" ADD COLUMN IF NOT EXISTS "applied_at" timestamp;
ALTER TABLE "stocktaking_items" ADD COLUMN IF NOT EXISTS "applied_quantity" integer;
