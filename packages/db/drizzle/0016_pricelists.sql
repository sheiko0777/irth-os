CREATE TABLE "price_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "currency" text DEFAULT 'EGP' NOT NULL,
  "discount_percent" numeric(5, 2),
  "is_default" boolean DEFAULT false NOT NULL,
  "customer_group_id" uuid,
  "start_date" timestamp,
  "end_date" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "price_list_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "price_list_id" uuid NOT NULL REFERENCES "price_lists"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "price" numeric(12, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);