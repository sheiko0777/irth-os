-- 0089: missing hot-path indexes.
--
-- Adds missing hot-path indexes for order_items, shipment_tracking, and orders tables.

CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_variant_id_idx" ON "order_items" ("variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_tracking_order_id_idx" ON "shipment_tracking" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_org_id_customer_id_idx" ON "orders" ("org_id", "customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_org_id_created_at_desc_idx" ON "orders" ("org_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_org_id_status_created_at_desc_idx" ON "orders" ("org_id", "status", "created_at" DESC);
