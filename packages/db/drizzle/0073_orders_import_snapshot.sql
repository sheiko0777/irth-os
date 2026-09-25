-- 0073: an imported order is either complete or visibly blocked — never partial.
--
-- Until now the Shopify orders/create webhook dropped every line whose variant
-- had no local match (`continue`) and still inserted the order with Shopify's
-- full total_price. The result was an order whose items did not sum to its
-- total, with no buyer name, no address and no trace of the missing lines in
-- the admin — the exact failure that triggered the re-plan (spec §1).
--
-- This migration gives the order row what it needs to never lose data:
--   import_status   'complete' (default; every existing and dashboard-created
--                   order) or 'blocked' (one or more lines could not be mapped,
--                   so no items were written and no stock was moved)
--   blocked_reason  human-readable cause, shown on the order page
--   source_payload  the provider's order payload as received, so a blocked
--                   order can be re-imported after its lines are mapped
--   buyer / shipping_address / billing_address   snapshots at order time
--   subtotal/discount/shipping/tax _minor         bigint minor units (rule 1)
--   customer_note   the buyer's note from the storefront
--
-- A blocked order cannot move forward: transitionOrderStatus (packages/db
-- orderLedger.ts) only advances orders whose import_status is 'complete',
-- except to 'cancelled'. That guard is in the UPDATE's WHERE clause, not an
-- `if` above it (CLAUDE.md rule 5).
--
-- Nullable snapshot columns: rows written before this migration have no
-- snapshot, and NULL there means "not captured", not "empty".
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "import_status" text NOT NULL DEFAULT 'complete';--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_import_status_check";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_import_status_check" CHECK ("import_status" IN ('complete', 'blocked'));--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_payload" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billing_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "subtotal_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_note" text;--> statement-breakpoint
-- The home dashboard and the orders list both ask "which orders are blocked"
-- per org; blocked orders are expected to be few, so a partial index is small.
CREATE INDEX IF NOT EXISTS "orders_org_id_blocked_idx" ON "orders" ("org_id") WHERE "import_status" = 'blocked';
