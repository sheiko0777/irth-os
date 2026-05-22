CREATE TABLE IF NOT EXISTS "eta_invoices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
    "order_id" uuid NOT NULL REFERENCES "orders"("id"),
    "eta_uuid" text,
    "status" text NOT NULL DEFAULT 'pending',
    "submitted_at" timestamp,
    "qr_code_data" text,
    "long_id" text,
    "error_message" text,
    "retry_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "eta_invoices_order_id_idx" ON "eta_invoices" ("order_id");
CREATE INDEX IF NOT EXISTS "eta_invoices_org_id_idx" ON "eta_invoices" ("org_id");
