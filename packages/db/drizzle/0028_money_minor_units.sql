-- Money as integer minor units (piastres for EGP), expand phase.
--
-- Adds a `_minor` bigint sibling column next to every currency-bearing
-- decimal/numeric column, backfilled from the existing value with exact
-- decimal arithmetic (`round(col * 100)` — safe here because it runs once in
-- SQL over already-stored values, not on every read/write in application
-- code, which is the float-arithmetic bug this migration exists to retire).
-- The old decimal columns are left in place and still written by legacy
-- code paths that have not been cut over yet; the `_minor` columns become
-- authoritative one call site at a time (order creation + Paymob first).
-- A later "contract" migration drops the decimal columns once every
-- consumer reads/writes `_minor` exclusively.
--
-- Two intentional exceptions, not migrated here:
--   - coupons.value: polymorphic (percentage 0-100 OR a fixed EGP amount,
--     selected by coupons.type) — not unambiguously money, stays decimal.
--   - shipping_rates.min_weight / max_weight: weight in kg, not currency.

-- products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "price_minor" bigint NOT NULL DEFAULT 0;
UPDATE "products" SET "price_minor" = ROUND("price" * 100)::bigint WHERE "price" IS NOT NULL;

-- product_variants
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "price_minor" bigint;
UPDATE "product_variants" SET "price_minor" = ROUND("price" * 100)::bigint WHERE "price" IS NOT NULL;

-- orders
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "total_amount_minor" bigint NOT NULL DEFAULT 0;
UPDATE "orders" SET "total_amount_minor" = ROUND("total_amount" * 100)::bigint WHERE "total_amount" IS NOT NULL;

-- order_items
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "price_minor" bigint NOT NULL DEFAULT 0;
UPDATE "order_items" SET "price_minor" = ROUND("price" * 100)::bigint WHERE "price" IS NOT NULL;

-- courier_shipments
ALTER TABLE "courier_shipments" ADD COLUMN IF NOT EXISTS "cod_amount_minor" bigint;
UPDATE "courier_shipments" SET "cod_amount_minor" = ROUND("cod_amount" * 100)::bigint WHERE "cod_amount" IS NOT NULL;

-- courier_remittances
ALTER TABLE "courier_remittances" ADD COLUMN IF NOT EXISTS "amount_minor" bigint NOT NULL DEFAULT 0;
UPDATE "courier_remittances" SET "amount_minor" = ROUND("amount" * 100)::bigint WHERE "amount" IS NOT NULL;

-- price_list_items
ALTER TABLE "price_list_items" ADD COLUMN IF NOT EXISTS "price_minor" bigint NOT NULL DEFAULT 0;
UPDATE "price_list_items" SET "price_minor" = ROUND("price" * 100)::bigint WHERE "price" IS NOT NULL;

-- order_returns
ALTER TABLE "order_returns" ADD COLUMN IF NOT EXISTS "refund_amount_minor" bigint;
UPDATE "order_returns" SET "refund_amount_minor" = ROUND("refund_amount" * 100)::bigint WHERE "refund_amount" IS NOT NULL;

-- return_items
ALTER TABLE "return_items" ADD COLUMN IF NOT EXISTS "unit_price_minor" bigint;
UPDATE "return_items" SET "unit_price_minor" = ROUND("unit_price" * 100)::bigint WHERE "unit_price" IS NOT NULL;

-- shipping_rates
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "price_minor" bigint NOT NULL DEFAULT 0;
UPDATE "shipping_rates" SET "price_minor" = ROUND("price" * 100)::bigint WHERE "price" IS NOT NULL;
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "min_order_value_minor" bigint;
UPDATE "shipping_rates" SET "min_order_value_minor" = ROUND("min_order_value" * 100)::bigint WHERE "min_order_value" IS NOT NULL;
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "max_order_value_minor" bigint;
UPDATE "shipping_rates" SET "max_order_value_minor" = ROUND("max_order_value" * 100)::bigint WHERE "max_order_value" IS NOT NULL;

-- gift_cards
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "initial_amount_minor" bigint NOT NULL DEFAULT 0;
UPDATE "gift_cards" SET "initial_amount_minor" = ROUND("initial_amount" * 100)::bigint WHERE "initial_amount" IS NOT NULL;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "balance_minor" bigint NOT NULL DEFAULT 0;
UPDATE "gift_cards" SET "balance_minor" = ROUND("balance" * 100)::bigint WHERE "balance" IS NOT NULL;

-- gift_card_transactions
ALTER TABLE "gift_card_transactions" ADD COLUMN IF NOT EXISTS "amount_minor" bigint NOT NULL DEFAULT 0;
UPDATE "gift_card_transactions" SET "amount_minor" = ROUND("amount" * 100)::bigint WHERE "amount" IS NOT NULL;

-- coupons (min_order_amount only — see exception note above for `value`)
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "min_order_amount_minor" bigint;
UPDATE "coupons" SET "min_order_amount_minor" = ROUND("min_order_amount" * 100)::bigint WHERE "min_order_amount" IS NOT NULL;

-- purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "total_amount_minor" bigint;
UPDATE "purchase_orders" SET "total_amount_minor" = ROUND("total_amount" * 100)::bigint WHERE "total_amount" IS NOT NULL;

-- purchase_order_items
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "unit_cost_minor" bigint;
UPDATE "purchase_order_items" SET "unit_cost_minor" = ROUND("unit_cost" * 100)::bigint WHERE "unit_cost" IS NOT NULL;

-- Order integrity: atomic per-org-per-year order numbering, replacing the
-- `count(*) + 1` race in the old order-creation path.
CREATE TABLE IF NOT EXISTS "order_number_counters" (
  "org_id" uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "last_seq" integer NOT NULL DEFAULT 0
);

-- Payment webhook idempotency ledger.
CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "order_id" uuid,
  "received_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("provider", "event_id")
);
