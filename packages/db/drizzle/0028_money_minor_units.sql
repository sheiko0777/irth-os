-- Money becomes an integer count of minor units (CLAUDE.md rule 1).
--
-- Every money column moves from numeric/decimal to bigint piastres. Columns are
-- RENAMED (price -> price_minor), not just retyped, on purpose: a value of 1999
-- is meaningful under both readings — 1999 EGP or 19.99 EGP — so a silent
-- reinterpretation is a 100x error that no type checker or test would notice.
-- Renaming makes every read site fail to compile until it has been looked at.
--
-- Safe to run as a straight ALTER because `public` on the production branch is
-- empty: the schema was never deployed. The USING clauses are still exact for
-- any data present in dev/test branches — the source columns are scale 2, so
-- (col * 100) is integer-valued and the cast loses nothing.

-- products ------------------------------------------------------------------
-- The default was 'USD' while gift_cards and price_lists defaulted to 'EGP'.
-- An Egyptian storefront pricing in dollars by default is a bug waiting for its
-- first multi-currency report.
ALTER TABLE "products" ALTER COLUMN "currency" SET DEFAULT 'EGP';--> statement-breakpoint
UPDATE "products" SET "currency" = 'EGP' WHERE "currency" = 'USD';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_minor" bigint;--> statement-breakpoint
UPDATE "products" SET "price_minor" = ROUND("price" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "price";--> statement-breakpoint

-- product_variants ----------------------------------------------------------
-- schema.ts had this nullable while migration 0000 created it NOT NULL. Settled
-- as nullable: a variant with no price of its own inherits the product's, and
-- that is the behaviour the admin already assumes.
ALTER TABLE "product_variants" ADD COLUMN "price_minor" bigint;--> statement-breakpoint
UPDATE "product_variants" SET "price_minor" = ROUND("price" * 100)::bigint WHERE "price" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" DROP COLUMN "price";--> statement-breakpoint

-- orders --------------------------------------------------------------------
ALTER TABLE "orders" ADD COLUMN "total_amount_minor" bigint;--> statement-breakpoint
UPDATE "orders" SET "total_amount_minor" = ROUND("total_amount" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "total_amount_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "total_amount";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" char(3) NOT NULL DEFAULT 'EGP';--> statement-breakpoint

-- order_items ---------------------------------------------------------------
-- No currency column: a line is denominated in its order's currency by
-- definition, and a second copy is a second thing that can disagree.
ALTER TABLE "order_items" ADD COLUMN "price_minor" bigint;--> statement-breakpoint
UPDATE "order_items" SET "price_minor" = ROUND("price" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "price_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "price";--> statement-breakpoint

-- coupons -------------------------------------------------------------------
-- `value` was polymorphic: a RATE when type='percentage' and MONEY when
-- type='fixed', in one numeric column. Any blanket "multiply money by 100"
-- migration would have turned a 10% coupon into 1000%. Split into two columns
-- so the type system and the database both know which is which, with a CHECK
-- that exactly the right one is populated for each coupon type.
ALTER TABLE "coupons" ADD COLUMN "percent_bp" integer;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
UPDATE "coupons" SET "percent_bp" = ROUND("value" * 100)::integer WHERE "type" = 'percentage';--> statement-breakpoint
UPDATE "coupons" SET "amount_minor" = ROUND("value" * 100)::bigint WHERE "type" IN ('fixed', 'free_shipping');--> statement-breakpoint
ALTER TABLE "coupons" DROP COLUMN "value";--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_matches_type" CHECK (
  (type = 'percentage'    AND percent_bp IS NOT NULL AND amount_minor IS NULL)
  OR (type = 'fixed'         AND amount_minor IS NOT NULL AND percent_bp IS NULL)
  OR (type = 'free_shipping' AND percent_bp IS NULL)
);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_percent_bp_range" CHECK (
  percent_bp IS NULL OR (percent_bp >= 0 AND percent_bp <= 10000)
);--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "min_order_amount_minor" bigint;--> statement-breakpoint
UPDATE "coupons" SET "min_order_amount_minor" = ROUND("min_order_amount" * 100)::bigint WHERE "min_order_amount" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" DROP COLUMN "min_order_amount";--> statement-breakpoint

-- couriers ------------------------------------------------------------------
ALTER TABLE "courier_shipments" ADD COLUMN "cod_amount_minor" bigint;--> statement-breakpoint
UPDATE "courier_shipments" SET "cod_amount_minor" = ROUND("cod_amount" * 100)::bigint WHERE "cod_amount" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_shipments" DROP COLUMN "cod_amount";--> statement-breakpoint
ALTER TABLE "courier_remittances" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
UPDATE "courier_remittances" SET "amount_minor" = ROUND("amount" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "courier_remittances" ALTER COLUMN "amount_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_remittances" DROP COLUMN "amount";--> statement-breakpoint

-- customers -----------------------------------------------------------------
ALTER TABLE "customers" ADD COLUMN "total_spent_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "customers" SET "total_spent_minor" = ROUND("total_spent" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "total_spent";--> statement-breakpoint

-- gift cards ----------------------------------------------------------------
ALTER TABLE "gift_cards" ADD COLUMN "initial_amount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "balance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "gift_cards" SET "initial_amount_minor" = ROUND("initial_amount" * 100)::bigint,
                        "balance_minor"        = ROUND("balance" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "gift_cards" DROP COLUMN "initial_amount";--> statement-breakpoint
ALTER TABLE "gift_cards" DROP COLUMN "balance";--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_balance_non_negative" CHECK (balance_minor >= 0);--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
UPDATE "gift_card_transactions" SET "amount_minor" = ROUND("amount" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ALTER COLUMN "amount_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" DROP COLUMN "amount";--> statement-breakpoint

-- price lists ---------------------------------------------------------------
-- discount_percent was numeric(5,2) holding a rate. Rates are integers in basis
-- points so nobody writes `total * (pct / 100)` in a float again.
ALTER TABLE "price_lists" ADD COLUMN "discount_bp" integer;--> statement-breakpoint
UPDATE "price_lists" SET "discount_bp" = ROUND("discount_percent" * 100)::integer WHERE "discount_percent" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "price_lists" DROP COLUMN "discount_percent";--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_discount_bp_range" CHECK (
  discount_bp IS NULL OR (discount_bp >= 0 AND discount_bp <= 10000)
);--> statement-breakpoint
ALTER TABLE "price_list_items" ADD COLUMN "price_minor" bigint;--> statement-breakpoint
UPDATE "price_list_items" SET "price_minor" = ROUND("price" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "price_list_items" ALTER COLUMN "price_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "price_list_items" DROP COLUMN "price";--> statement-breakpoint

-- purchasing ----------------------------------------------------------------
ALTER TABLE "purchase_orders" ADD COLUMN "total_amount_minor" bigint;--> statement-breakpoint
UPDATE "purchase_orders" SET "total_amount_minor" = ROUND("total_amount" * 100)::bigint WHERE "total_amount" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN "total_amount";--> statement-breakpoint
-- A supplier may genuinely invoice in a foreign currency, so this document
-- carries its own denomination rather than assuming the org's.
ALTER TABLE "purchase_orders" ADD COLUMN "currency" char(3) NOT NULL DEFAULT 'EGP';--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "unit_cost_minor" bigint;--> statement-breakpoint
UPDATE "purchase_order_items" SET "unit_cost_minor" = ROUND("unit_cost" * 100)::bigint WHERE "unit_cost" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" DROP COLUMN "unit_cost";--> statement-breakpoint

-- returns -------------------------------------------------------------------
ALTER TABLE "order_returns" ADD COLUMN "refund_amount_minor" bigint;--> statement-breakpoint
UPDATE "order_returns" SET "refund_amount_minor" = ROUND("refund_amount" * 100)::bigint WHERE "refund_amount" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "order_returns" DROP COLUMN "refund_amount";--> statement-breakpoint
ALTER TABLE "return_items" ADD COLUMN "unit_price_minor" bigint;--> statement-breakpoint
UPDATE "return_items" SET "unit_price_minor" = ROUND("unit_price" * 100)::bigint WHERE "unit_price" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "return_items" DROP COLUMN "unit_price";--> statement-breakpoint

-- shipping ------------------------------------------------------------------
-- min_weight / max_weight stay numeric: a parcel really does weigh 1.250 kg.
-- They are quantities, not money, and rule 1 does not apply to them.
ALTER TABLE "shipping_rates" ADD COLUMN "price_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "min_order_value_minor" bigint;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "max_order_value_minor" bigint;--> statement-breakpoint
UPDATE "shipping_rates" SET "price_minor"           = ROUND("price" * 100)::bigint,
                            "min_order_value_minor" = ROUND("min_order_value" * 100)::bigint,
                            "max_order_value_minor" = ROUND("max_order_value" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "shipping_rates" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "shipping_rates" DROP COLUMN "min_order_value";--> statement-breakpoint
ALTER TABLE "shipping_rates" DROP COLUMN "max_order_value";
