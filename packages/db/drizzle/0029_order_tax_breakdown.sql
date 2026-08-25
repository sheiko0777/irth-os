-- Fixes two defects that block multi-tenancy and correct tax reporting.
--
-- (1) ORDER NUMBER UNIQUENESS WAS GLOBAL, NOT PER-TENANT
--
-- `orders_order_number_unique UNIQUE(order_number)` (0000) combined with
-- per-org sequence allocation (order_number_counters, 0028) meant every org's
-- first order was "IRT-<year>-0001". The first tenant to create an order
-- claimed that string globally; the second tenant's first order failed on a
-- unique violation and could never succeed. Order numbers are per-tenant
-- document identifiers, so the constraint becomes (org_id, order_number).
--
-- (2) NOTHING RECORDED WHETHER total_amount INCLUDED TAX
--
-- The schema had no tax column anywhere, so each consumer invented its own
-- convention and they disagreed:
--   - finance.vatReport treated total as tax-INCLUSIVE and extracted
--     `total * 0.14` — itself wrong even under that reading (extracting 14%
--     from a gross figure is total * 14/114 = 0.1228), overstating VAT on a
--     tax filing by ~14%.
--   - services/eta.ts treated the same number as tax-EXCLUSIVE and submitted
--     `total * 1.14` to the Egyptian Tax Authority, invoicing the customer
--     14% more than they actually paid.
-- Both cannot be right. The split is now recorded explicitly at sale time and
-- held by a CHECK constraint, so no reader has to guess.

-- (1) ---------------------------------------------------------------------
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_order_number_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "orders_org_id_order_number_idx"
  ON "orders" ("org_id", "order_number");

-- (2) ---------------------------------------------------------------------
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "subtotal_minor"     bigint  NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_amount_minor"   bigint  NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_rate_bps"       integer NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "prices_include_tax" boolean NOT NULL DEFAULT true;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "currency"           text    NOT NULL DEFAULT 'EGP';

-- Backfill: deliberately does NOT invent tax for historical orders.
--
-- These rows were written when no tax was recorded and the two consumers
-- disagreed about what the number meant, so the true split is genuinely
-- unknown. Assigning them 14% would fabricate figures on rows that may feed a
-- tax return. Instead they are marked tax_rate_bps = 0 / tax_amount_minor = 0,
-- which reads honestly as "this order carries no broken-out tax" and keeps
-- subtotal + tax = total true. vatReport reports these separately as
-- `unbrokenOutOrders` so a zero is never mistaken for "no sales".
UPDATE "orders"
   SET "subtotal_minor" = "total_amount_minor",
       "tax_amount_minor" = 0,
       "tax_rate_bps" = 0
 WHERE "subtotal_minor" = 0
   AND "total_amount_minor" <> 0;

-- The invariant. Any writer that bypasses @irth/utils' splitTax and produces
-- an inconsistent triple is rejected by the database rather than silently
-- corrupting the books.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_money_split_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_split_check"
  CHECK ("subtotal_minor" + "tax_amount_minor" = "total_amount_minor");
