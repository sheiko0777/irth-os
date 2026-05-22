CREATE TABLE IF NOT EXISTS "courier_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"courier" text NOT NULL,
	"tracking_number" text,
	"courier_status" text DEFAULT 'created' NOT NULL,
	"cod_amount" numeric(12, 2),
	"cod_collected" boolean DEFAULT false NOT NULL,
	"cod_remitted" boolean DEFAULT false NOT NULL,
	"remittance_id" text,
	"remittance_date" timestamp,
	"webhook_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "courier_shipments_order_id_unique" UNIQUE("order_id")
);

CREATE TABLE IF NOT EXISTS "courier_remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"courier" text NOT NULL,
	"remittance_reference" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"shipment_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expected_date" timestamp,
	"received_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);

DO $$ BEGIN
 ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "courier_remittances" ADD CONSTRAINT "courier_remittances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "courier_shipments_org_id_idx" ON "courier_shipments" ("org_id");
CREATE INDEX IF NOT EXISTS "courier_shipments_order_id_idx" ON "courier_shipments" ("order_id");
CREATE INDEX IF NOT EXISTS "courier_remittances_org_id_idx" ON "courier_remittances" ("org_id");
CREATE INDEX IF NOT EXISTS "courier_remittances_courier_org_id_idx" ON "courier_remittances" ("courier", "org_id");
