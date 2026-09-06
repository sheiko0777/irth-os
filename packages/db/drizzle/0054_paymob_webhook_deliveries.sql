CREATE TABLE IF NOT EXISTS "paymob_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid,
	"transaction_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'processed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "paymob_webhook_deliveries" ADD CONSTRAINT "paymob_webhook_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "paymob_webhook_deliveries" ADD CONSTRAINT "paymob_webhook_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "paymob_webhook_deliveries_org_transaction_idx" ON "paymob_webhook_deliveries" ("org_id", "transaction_id");

--> statement-breakpoint
ALTER TABLE "paymob_webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "paymob_webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "paymob_webhook_deliveries"
  AS PERMISSIVE FOR ALL
  TO public
  USING ("org_id" = current_setting('app.current_org_id', true)::uuid);
