-- Index every org_id, ahead of RLS.
--
-- An RLS policy adds an implicit `org_id = current_setting(...)` predicate to
-- every statement against the table. Twelve tenant tables currently have an
-- org_id column with no index on it — including `orders`, `products`,
-- `order_items` and `product_variants`, which are the hottest tables in the
-- app. Enabling policies before these exist turns every list query into a
-- sequential scan filtered by tenant.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: the migration runner wraps each
-- file in a transaction (packages/db/scripts/migrate.mjs) and CONCURRENTLY
-- cannot run inside one. These are cheap now because `public` on production is
-- empty; if that ever stops being true, split this file and run the rebuilds
-- concurrently outside the runner.
--
-- Single-column on purpose. Composite indexes want real query shapes and real
-- cardinality to justify them, and there is no production data yet to measure
-- against — guessing now would just add write cost for reads that may never
-- happen.

CREATE INDEX IF NOT EXISTS "activity_log_org_id_idx" ON "activity_log" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_id_idx" ON "audit_log" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_org_id_idx" ON "categories" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_transactions_org_id_idx" ON "loyalty_transactions" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_org_id_idx" ON "notifications" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_org_id_idx" ON "order_items" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_org_id_idx" ON "orders" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_invites_org_id_idx" ON "org_invites" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_members_org_id_idx" ON "org_members" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_org_id_idx" ON "product_variants" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_org_id_idx" ON "products" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_tracking_org_id_idx" ON "shipment_tracking" ("org_id");
