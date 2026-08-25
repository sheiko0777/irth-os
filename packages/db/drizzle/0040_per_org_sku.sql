-- SKUs become unique PER TENANT, closing the last of this class.
--
-- THE DEFECT
--
-- `products_sku_unique` and `product_variants_sku_unique` are UNIQUE on (sku)
-- alone — global, not per organization. A SKU is a merchant's own internal
-- product code, chosen freely and independently by each merchant, and common
-- codes collide constantly across businesses ("SHIRT-M-BLUE", "BOX-01",
-- "1001"). The first tenant to register one permanently prevents every other
-- tenant from ever using it, with a 23505 they cannot act on. That is one
-- tenant's ordinary use denying service to another — the same multi-tenant
-- defect migration 0035 fixed for order_number, return_number and po_number.
--
-- 0035 covered the three generated document numbers and stopped there; `sku` is
-- user-supplied rather than generated, so it sat in a different part of the
-- schema and was missed. The consequence is identical.
--
-- It also leaks: a failed insert tells the caller that some other organization
-- already registered that exact SKU, which is a probe into another tenant's
-- catalogue.
--
-- WHY THIS IS SAFE TO CHANGE NOW
--
-- Scoping requires an org_id on both tables. `products` always had one;
-- `product_variants` only gained it in 0027/0028, which is why the two existing
-- SKU lookups (purchasing.receive, stocktaking.apply) reach the tenant by
-- joining through `products` instead. Those joins keep working unchanged — they
-- become the correct query rather than a defensive workaround.
--
-- Unique INDEXes rather than table constraints, matching 0035 and the rest of
-- this schema's per-tenant rules (coupons_org_code_idx, eta_invoices_order_id_idx).

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_org_id_sku_idx"
  ON "products" ("org_id", "sku");--> statement-breakpoint

ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_sku_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_org_id_sku_idx"
  ON "product_variants" ("org_id", "sku");
