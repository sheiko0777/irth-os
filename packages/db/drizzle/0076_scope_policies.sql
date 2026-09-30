-- 0076: data scopes enforced by the database (PR-1e, owner decision A5).
--
-- A member limited to some brands or suppliers (member_scopes, 0074) must not
-- see, or write, anything outside them, however a query is written.
-- withOrgContext sets two transaction-local settings beside app.org_id:
--
--   app.brand_ids     comma-separated brand uuids, '' = unrestricted
--   app.supplier_ids  comma-separated supplier uuids, '' = unrestricted
--
-- The policies below are RESTRICTIVE: Postgres ANDs them with the existing
-- permissive tenant policy on each table, so they can only narrow what a
-- transaction sees — never widen it past its org. USING filters reads,
-- updates and deletes; WITH CHECK refuses writing a row outside the scope.
--
-- Scope kinds covered now, by owner decision: brand and supplier. Warehouse
-- and channel scopes wait for stock and orders to carry those columns
-- (IN-01); a scope the database cannot enforce is not offered at all.
--
-- Child tables are scoped through their parent, whose own policies apply
-- inside the subquery (the invoker is irth_app): a variant is visible only
-- if its product is, a stock row only if its variant is, a purchase order
-- line only if its order is.
--
-- The code also filters explicitly (CLAUDE.md rule 3: two layers); these
-- policies are the layer that holds when a query forgets.

CREATE FUNCTION "scope_ids"(p_setting text) RETURNS uuid[]
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(current_setting(p_setting, true), '') = '' THEN NULL
    ELSE string_to_array(current_setting(p_setting, true), ',')::uuid[]
  END
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "scope_ids"(text) TO "irth_app";--> statement-breakpoint

-- Brand -----------------------------------------------------------------------
CREATE POLICY "products_brand_scope" ON "products" AS RESTRICTIVE
  USING (scope_ids('app.brand_ids') IS NULL OR "brand_id" = ANY (scope_ids('app.brand_ids')))
  WITH CHECK (scope_ids('app.brand_ids') IS NULL OR "brand_id" = ANY (scope_ids('app.brand_ids')));--> statement-breakpoint

CREATE POLICY "product_variants_brand_scope" ON "product_variants" AS RESTRICTIVE
  USING (scope_ids('app.brand_ids') IS NULL OR "product_id" IN (SELECT "id" FROM "products"))
  WITH CHECK (scope_ids('app.brand_ids') IS NULL OR "product_id" IN (SELECT "id" FROM "products"));--> statement-breakpoint

CREATE POLICY "inventory_items_brand_scope" ON "inventory_items" AS RESTRICTIVE
  USING (scope_ids('app.brand_ids') IS NULL OR "variant_id" IN (SELECT "id" FROM "product_variants"))
  WITH CHECK (scope_ids('app.brand_ids') IS NULL OR "variant_id" IN (SELECT "id" FROM "product_variants"));--> statement-breakpoint

-- Supplier --------------------------------------------------------------------
CREATE POLICY "suppliers_supplier_scope" ON "suppliers" AS RESTRICTIVE
  USING (scope_ids('app.supplier_ids') IS NULL OR "id" = ANY (scope_ids('app.supplier_ids')))
  WITH CHECK (scope_ids('app.supplier_ids') IS NULL OR "id" = ANY (scope_ids('app.supplier_ids')));--> statement-breakpoint

CREATE POLICY "purchase_orders_supplier_scope" ON "purchase_orders" AS RESTRICTIVE
  USING (scope_ids('app.supplier_ids') IS NULL OR "supplier_id" = ANY (scope_ids('app.supplier_ids')))
  WITH CHECK (scope_ids('app.supplier_ids') IS NULL OR "supplier_id" = ANY (scope_ids('app.supplier_ids')));--> statement-breakpoint

CREATE POLICY "purchase_order_items_supplier_scope" ON "purchase_order_items" AS RESTRICTIVE
  USING (scope_ids('app.supplier_ids') IS NULL OR "po_id" IN (SELECT "id" FROM "purchase_orders"))
  WITH CHECK (scope_ids('app.supplier_ids') IS NULL OR "po_id" IN (SELECT "id" FROM "purchase_orders"));
