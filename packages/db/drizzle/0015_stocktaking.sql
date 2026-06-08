CREATE TYPE "stocktaking_status" AS ENUM ('draft', 'in_progress', 'completed', 'cancelled');

CREATE TABLE "stocktaking_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "status" "stocktaking_status" DEFAULT 'draft' NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "stocktaking_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "stocktaking_sessions"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "sku" text NOT NULL,
  "product_name" text NOT NULL,
  "expected_quantity" integer DEFAULT 0 NOT NULL,
  "actual_quantity" integer,
  "variance" integer,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);