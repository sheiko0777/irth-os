CREATE TABLE IF NOT EXISTS "order_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"return_number" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"resolution_type" text DEFAULT 'none' NOT NULL,
	"notes" text,
	"admin_notes" text,
	"refund_amount" numeric(12, 2),
	"requested_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid,
	"product_name" text NOT NULL,
	"variant_name" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2),
	"condition" text DEFAULT 'unknown',
	"restock" boolean DEFAULT false NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_order_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."order_returns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "order_returns_org_id_idx" ON "order_returns" ("org_id");
CREATE INDEX IF NOT EXISTS "order_returns_order_id_idx" ON "order_returns" ("order_id");
CREATE INDEX IF NOT EXISTS "return_items_return_id_idx" ON "return_items" ("return_id");