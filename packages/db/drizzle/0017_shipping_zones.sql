CREATE TYPE "shipping_rate_type" AS ENUM ('flat', 'weight_based', 'price_based', 'free');

CREATE TABLE "shipping_zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "shipping_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "zone_id" uuid NOT NULL REFERENCES "shipping_zones"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "rate_type" "shipping_rate_type" DEFAULT 'flat' NOT NULL,
  "price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "min_order_value" numeric(12, 2),
  "max_order_value" numeric(12, 2),
  "min_weight" numeric(8, 3),
  "max_weight" numeric(8, 3),
  "estimated_days_min" integer,
  "estimated_days_max" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);