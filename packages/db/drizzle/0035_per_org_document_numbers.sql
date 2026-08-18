-- Document numbers become unique PER TENANT, and start being constrained at all.
--
-- THE DEFECTS
--
-- Three human-facing document numbers are generated per organization, each from
-- a `count(*) + 1` over that org's rows:
--
--   orders.order_number          IRT-2026-0001   (apps/api/src/routes/orders.ts)
--   order_returns.return_number  RMA-0001        (admin returns.create)
--   purchase_orders.po_number    PO-0001         (admin purchasing)
--
-- Their constraints did not match that design:
--
-- 1. `orders_order_number_unique` was UNIQUE ON (order_number) ALONE — global,
--    not per tenant. Every organization's first order is IRT-2026-0001, so the
--    SECOND organization ever to place an order gets a unique violation and
--    cannot order at all. One tenant's ordinary use permanently blocks another's
--    — a multi-tenant denial of service built into the schema.
--
-- 2. `return_number` and `po_number` had NO unique constraint of any kind. The
--    count(*)+1 race there is therefore not merely likely to collide — nothing
--    rejects the collision. Two returns legitimately share RMA-0004, and any
--    report keyed on that number silently merges them.
--
-- Unique INDEXes rather than table constraints, matching how every other
-- per-tenant uniqueness rule in this schema is expressed (coupons_org_code_idx,
-- eta_invoices_order_id_idx).
--
-- WHAT THIS DOES NOT FIX
--
-- The race itself. count(*)+1 is read-then-write: at READ COMMITTED two
-- concurrent creates both count N and both build N+1. These indexes turn a
-- silent duplicate into a loud failure — strictly better, still a failure. The
-- generator is replaced with a per-org counter next; the constraint lands first
-- so there is something enforcing the counter's contract.

-- orders: the global unique goes, a per-tenant one replaces it.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_order_number_unique";
DROP INDEX IF EXISTS "orders_order_number_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "orders_org_order_number_idx"
  ON "orders" ("org_id", "order_number");

-- returns and purchase orders: constrained for the first time.
CREATE UNIQUE INDEX IF NOT EXISTS "order_returns_org_return_number_idx"
  ON "order_returns" ("org_id", "return_number");

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_org_po_number_idx"
  ON "purchase_orders" ("org_id", "po_number");
