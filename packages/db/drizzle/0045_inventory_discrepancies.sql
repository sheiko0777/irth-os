-- 0045: track Shopify sales that outran available stock.
--
-- The orders/create webhook decremented inventory unconditionally, with no
-- `quantity >= n` floor - Shopify (not this dashboard) is the orders source
-- of truth, so a shortfall cannot be rejected the way the dashboard's own
-- order-creation path rejects an oversell (apps/api/src/routes/orders.ts's
-- InsufficientStockError). The fix applies what's actually on hand, floors
-- at zero, and records the shortfall here instead of letting quantity go
-- negative or silently no-op'ing.

CREATE TYPE "public"."discrepancy_status" AS ENUM('open', 'acknowledged', 'resolved');
--> statement-breakpoint

CREATE TABLE "inventory_discrepancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id"),
  "shopify_order_id" text,
  "requested_quantity" integer NOT NULL,
  "applied_quantity" integer NOT NULL,
  "shortfall_quantity" integer NOT NULL,
  "movement_id" uuid REFERENCES "inventory_movements"("id"),
  "status" "discrepancy_status" NOT NULL DEFAULT 'open',
  "resolved_by" text,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "inventory_discrepancies_org_id_idx" ON "inventory_discrepancies" ("org_id");
--> statement-breakpoint

CREATE INDEX "inventory_discrepancies_org_id_status_idx" ON "inventory_discrepancies" ("org_id", "status");
