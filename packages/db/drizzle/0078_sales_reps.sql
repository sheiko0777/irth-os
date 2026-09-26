-- 0078: sales reps — their customers, their orders and quotes, their price lists (PR-2b).
--
-- A sales rep (org_members.principal_kind = 'sales_rep') looks after a book of
-- customers, places orders for them and prepares quotes, at the prices of the
-- price lists they are allowed to use. What they see is narrowed in the code
-- AND here (CLAUDE.md rule 3), using the settings withOrgContext already sets
-- transaction-locally for 0077 (app.member_id, app.principal_kind) plus one
-- more:
--
--   app.pricelist_ids  comma-separated price list uuids, '' = unrestricted
--
-- A sales rep sees:
--   customers   assigned to them (customers.sales_rep_member_id)
--   orders      they placed (orders.created_by_member_id), or of their customers
--   quotes      they prepared
-- and, like every member with a price-list scope, only those price lists.
-- The policies fail closed: a rep transaction without app.member_id sees none
-- of these rows.

-- Who a customer belongs to, and who placed an order ---------------------------
ALTER TABLE "customers" ADD COLUMN "sales_rep_member_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_rep_same_org_fk"
  FOREIGN KEY ("sales_rep_member_id", "org_id") REFERENCES "org_members"("id", "org_id")
  ON DELETE SET NULL ("sales_rep_member_id");--> statement-breakpoint
CREATE INDEX "customers_org_sales_rep_idx" ON "customers" ("org_id", "sales_rep_member_id")
  WHERE "sales_rep_member_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN "created_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_same_org_fk"
  FOREIGN KEY ("created_by_member_id", "org_id") REFERENCES "org_members"("id", "org_id")
  ON DELETE SET NULL ("created_by_member_id");--> statement-breakpoint
CREATE INDEX "orders_org_created_by_idx" ON "orders" ("org_id", "created_by_member_id")
  WHERE "created_by_member_id" IS NOT NULL;--> statement-breakpoint

-- Price lists become a data-scope kind -------------------------------------------
ALTER TABLE "member_scopes" DROP CONSTRAINT "member_scopes_kind_check";--> statement-breakpoint
ALTER TABLE "member_scopes" ADD CONSTRAINT "member_scopes_kind_check"
  CHECK ("scope_kind" IN ('warehouse', 'brand', 'channel', 'supplier', 'pricelist'));--> statement-breakpoint

-- Quotes ---------------------------------------------------------------------------
-- A priced proposal for a customer. It moves no stock and posts nothing; it
-- becomes an order (converted_order_id) through the same placement as any
-- other order, at the quoted prices, while it is still valid.
CREATE TABLE "sales_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "quote_number" varchar(50) NOT NULL,
  "customer_id" uuid NOT NULL,
  "created_by_member_id" uuid,
  "price_list_id" uuid,
  "currency" char(3) NOT NULL,
  "subtotal_minor" bigint NOT NULL,
  "discount_minor" bigint NOT NULL,
  "total_minor" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "valid_until" timestamp NOT NULL,
  "converted_order_id" uuid,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "sales_quotes_id_org_id_key" UNIQUE ("id", "org_id"),
  CONSTRAINT "sales_quotes_org_number_uq" UNIQUE ("org_id", "quote_number"),
  CONSTRAINT "sales_quotes_created_by_same_org_fk"
    FOREIGN KEY ("created_by_member_id", "org_id") REFERENCES "org_members"("id", "org_id")
    ON DELETE SET NULL ("created_by_member_id"),
  CONSTRAINT "sales_quotes_order_same_org_fk"
    FOREIGN KEY ("converted_order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  CONSTRAINT "sales_quotes_status_check" CHECK ("status" IN ('open', 'converted', 'cancelled')),
  CONSTRAINT "sales_quotes_converted_check" CHECK (("status" = 'converted') = ("converted_order_id" IS NOT NULL)),
  CONSTRAINT "sales_quotes_amounts_check" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" = "subtotal_minor" - "discount_minor"
  ),
  CONSTRAINT "sales_quotes_notes_length_check" CHECK ("notes" IS NULL OR length("notes") <= 1000)
);--> statement-breakpoint
CREATE INDEX "sales_quotes_org_created_by_idx" ON "sales_quotes" ("org_id", "created_by_member_id");--> statement-breakpoint
CREATE INDEX "sales_quotes_org_customer_idx" ON "sales_quotes" ("org_id", "customer_id");--> statement-breakpoint

CREATE TABLE "sales_quote_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "quote_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  -- The list price before the price list's discount, and what the customer pays.
  "list_price_minor" bigint NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  CONSTRAINT "sales_quote_items_quote_same_org_fk"
    FOREIGN KEY ("quote_id", "org_id") REFERENCES "sales_quotes"("id", "org_id") ON DELETE CASCADE,
  CONSTRAINT "sales_quote_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "sales_quote_items_price_check" CHECK ("unit_price_minor" >= 0 AND "unit_price_minor" <= "list_price_minor")
);--> statement-breakpoint
CREATE INDEX "sales_quote_items_org_quote_idx" ON "sales_quote_items" ("org_id", "quote_id");--> statement-breakpoint

ALTER TABLE "sales_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_quotes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sales_quotes_tenant_isolation" ON "sales_quotes"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "sales_quote_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_quote_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sales_quote_items_tenant_isolation" ON "sales_quote_items"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
-- A quote is never deleted: it is cancelled or converted.
GRANT SELECT, INSERT, UPDATE ON "sales_quotes" TO "irth_app";--> statement-breakpoint
REVOKE DELETE ON "sales_quotes" FROM "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "sales_quote_items" TO "irth_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "sales_quote_items" FROM "irth_app";--> statement-breakpoint

-- A sales rep sees only their own book ----------------------------------------------
CREATE FUNCTION "app_is_sales_rep"() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.principal_kind', true), '') = 'sales_rep'
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_is_sales_rep"() TO "irth_app";--> statement-breakpoint

CREATE POLICY "customers_sales_rep_scope" ON "customers" AS RESTRICTIVE
  USING (NOT app_is_sales_rep() OR "sales_rep_member_id" = app_member_id())
  WITH CHECK (NOT app_is_sales_rep() OR "sales_rep_member_id" = app_member_id());--> statement-breakpoint
-- Orders they placed, or of their customers (the subquery is itself narrowed
-- by customers_sales_rep_scope). A new order must be placed as themselves.
CREATE POLICY "orders_sales_rep_scope" ON "orders" AS RESTRICTIVE
  USING (NOT app_is_sales_rep()
    OR "created_by_member_id" = app_member_id()
    OR "customer_id" IN (SELECT "id" FROM "customers"))
  WITH CHECK (NOT app_is_sales_rep() OR "created_by_member_id" = app_member_id());--> statement-breakpoint
CREATE POLICY "order_items_sales_rep_scope" ON "order_items" AS RESTRICTIVE
  USING (NOT app_is_sales_rep() OR "order_id" IN (SELECT "id" FROM "orders"))
  WITH CHECK (NOT app_is_sales_rep() OR "order_id" IN (SELECT "id" FROM "orders"));--> statement-breakpoint
CREATE POLICY "sales_quotes_sales_rep_scope" ON "sales_quotes" AS RESTRICTIVE
  USING (NOT app_is_sales_rep() OR "created_by_member_id" = app_member_id())
  WITH CHECK (NOT app_is_sales_rep() OR "created_by_member_id" = app_member_id());--> statement-breakpoint
CREATE POLICY "sales_quote_items_sales_rep_scope" ON "sales_quote_items" AS RESTRICTIVE
  USING (NOT app_is_sales_rep() OR "quote_id" IN (SELECT "id" FROM "sales_quotes"))
  WITH CHECK (NOT app_is_sales_rep() OR "quote_id" IN (SELECT "id" FROM "sales_quotes"));--> statement-breakpoint

-- Price-list scope, for any member (0076 shape) --------------------------------------
CREATE POLICY "price_lists_pricelist_scope" ON "price_lists" AS RESTRICTIVE
  USING (scope_ids('app.pricelist_ids') IS NULL OR "id" = ANY (scope_ids('app.pricelist_ids')))
  WITH CHECK (scope_ids('app.pricelist_ids') IS NULL OR "id" = ANY (scope_ids('app.pricelist_ids')));--> statement-breakpoint
CREATE POLICY "price_list_items_pricelist_scope" ON "price_list_items" AS RESTRICTIVE
  USING (scope_ids('app.pricelist_ids') IS NULL OR "price_list_id" IN (SELECT "id" FROM "price_lists"))
  WITH CHECK (scope_ids('app.pricelist_ids') IS NULL OR "price_list_id" IN (SELECT "id" FROM "price_lists"));
