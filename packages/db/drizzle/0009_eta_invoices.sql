CREATE TABLE IF NOT EXISTS "eta_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"eta_uuid" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp,
	"qr_code_data" text,
	"long_id" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);

DO $$ BEGIN
 ALTER TABLE "eta_invoices" ADD CONSTRAINT "eta_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "eta_invoices" ADD CONSTRAINT "eta_invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "eta_invoices_org_id_idx" ON "eta_invoices" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "eta_invoices_order_id_idx" ON "eta_invoices" ("order_id");
