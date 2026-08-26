-- Shopify two-way sync: maps local rows to their Shopify counterparts.
--
-- The dashboard is the source of truth for products/variants (its own prices,
-- SKUs, content are authoritative and get pushed OUT to Shopify). Orders and
-- customers originate on the Shopify storefront and flow IN. Either direction
-- needs a stable foreign key back to the other system so a webhook retry or a
-- re-push updates the existing row instead of creating a duplicate.
--
-- All four columns are nullable: a product created before this sync existed,
-- or one never pushed, has no Shopify counterpart yet. NULL is exactly that —
-- "not linked" — not an empty string standing in for it.
--
-- Unique per ORG, not globally, matching every other tenant-scoped rule in
-- this schema (0035, 0040): a bare UNIQUE column would let one org's Shopify
-- link collide with another's and deny it service. A plain unique index
-- already allows unlimited NULLs (NULL <> NULL in Postgres), so no partial
-- WHERE clause is needed to keep unlinked rows out of each other's way.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shopify_product_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_org_id_shopify_product_id_idx"
  ON "products" ("org_id", "shopify_product_id");--> statement-breakpoint

ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "shopify_variant_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_org_id_shopify_variant_id_idx"
  ON "product_variants" ("org_id", "shopify_variant_id");--> statement-breakpoint

-- Shopify's inventory_levels/update webhook payload keys by inventory_item_id,
-- not by variant id or SKU — a separate GID that only exists once the variant
-- has been pushed and Shopify has allocated storage for it. Stored alongside
-- shopify_variant_id rather than derived from it, since resolving it back
-- would otherwise mean an extra Shopify API round trip on every inbound stock
-- webhook.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "shopify_inventory_item_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_org_id_shopify_inventory_item_id_idx"
  ON "product_variants" ("org_id", "shopify_inventory_item_id");--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shopify_order_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_org_id_shopify_order_id_idx"
  ON "orders" ("org_id", "shopify_order_id");--> statement-breakpoint

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shopify_customer_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_org_id_shopify_customer_id_idx"
  ON "customers" ("org_id", "shopify_customer_id");
