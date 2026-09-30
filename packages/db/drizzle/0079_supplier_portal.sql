-- 0079: supplier portal and supplier payments (PR-3).
--
-- A supplier gets their own account (org_members.principal_kind = 'supplier',
-- limited by a supplier scope to their own supplier row, 0074/0076). In a
-- separate, simple portal they see the purchase orders sent to them, confirm
-- one or propose another delivery date, send a shipping notice (ASN), and see
-- what they are owed. The office records payments to suppliers, which close
-- the payable the goods receipt opened:
--
--   received   Dr 1040 inventory / Cr 2010 payable   (purchasing.receive, unchanged)
--   paid       Dr 2010 payable   / Cr 1020 bank | 1010 cash   (new)
--
-- What a supplier sees is narrowed twice: 0076's supplier-scope policies, and
-- here a rule that a SUPPLIER with no scope sees nothing at all — for anyone
-- else no scope means unrestricted, for a supplier it would mean every other
-- supplier's orders. The ledger itself is closed to supplier accounts; their
-- statement is read through supplier_statement(), which answers only for the
-- caller's own supplier.

-- The supplier's side of a purchase order -------------------------------------------
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "expected_delivery_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "proposed_delivery_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_note" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_responded_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_status_check"
  CHECK ("supplier_status" IN ('pending', 'confirmed', 'date_proposed'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_proposed_date_check"
  CHECK (("supplier_status" = 'date_proposed') = ("proposed_delivery_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_note_length_check"
  CHECK ("supplier_note" IS NULL OR length("supplier_note") <= 1000);--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint

-- Shipping notices (ASN): append-only -------------------------------------------------
CREATE TABLE "purchase_order_shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "po_id" uuid NOT NULL,
  "shipped_at" timestamp NOT NULL,
  "expected_arrival_at" timestamp,
  "reference" text,
  "note" text,
  "created_by_member_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_order_shipments_id_org_id_key" UNIQUE ("id", "org_id"),
  CONSTRAINT "purchase_order_shipments_po_same_org_fk"
    FOREIGN KEY ("po_id", "org_id") REFERENCES "purchase_orders"("id", "org_id"),
  CONSTRAINT "purchase_order_shipments_member_same_org_fk"
    FOREIGN KEY ("created_by_member_id", "org_id") REFERENCES "org_members"("id", "org_id")
    ON DELETE SET NULL ("created_by_member_id"),
  CONSTRAINT "purchase_order_shipments_text_length_check"
    CHECK ((reference IS NULL OR length(reference) <= 200) AND (note IS NULL OR length(note) <= 1000))
);--> statement-breakpoint
CREATE INDEX "purchase_order_shipments_org_po_idx" ON "purchase_order_shipments" ("org_id", "po_id");--> statement-breakpoint

CREATE TABLE "purchase_order_shipment_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "shipment_id" uuid NOT NULL,
  "po_item_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  CONSTRAINT "purchase_order_shipment_items_shipment_same_org_fk"
    FOREIGN KEY ("shipment_id", "org_id") REFERENCES "purchase_order_shipments"("id", "org_id"),
  CONSTRAINT "purchase_order_shipment_items_item_same_org_fk"
    FOREIGN KEY ("po_item_id", "org_id") REFERENCES "purchase_order_items"("id", "org_id"),
  CONSTRAINT "purchase_order_shipment_items_quantity_check" CHECK ("quantity" > 0)
);--> statement-breakpoint
CREATE INDEX "purchase_order_shipment_items_org_shipment_idx" ON "purchase_order_shipment_items" ("org_id", "shipment_id");--> statement-breakpoint

-- Payments to suppliers: append-only; a correction is a reversing entry ---------------
CREATE TABLE "supplier_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "supplier_id" uuid NOT NULL,
  "po_id" uuid,
  "amount_minor" bigint NOT NULL,
  "currency" char(3) NOT NULL,
  "method" text NOT NULL,
  "reference" text,
  "paid_at" timestamp NOT NULL DEFAULT now(),
  "journal_entry_id" uuid NOT NULL,
  "created_by" text,
  CONSTRAINT "supplier_payments_supplier_same_org_fk"
    FOREIGN KEY ("supplier_id", "org_id") REFERENCES "suppliers"("id", "org_id"),
  CONSTRAINT "supplier_payments_po_same_org_fk"
    FOREIGN KEY ("po_id", "org_id") REFERENCES "purchase_orders"("id", "org_id"),
  CONSTRAINT "supplier_payments_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "supplier_payments_method_check" CHECK ("method" IN ('cash', 'bank')),
  CONSTRAINT "supplier_payments_reference_length_check" CHECK ("reference" IS NULL OR length("reference") <= 200)
);--> statement-breakpoint
CREATE INDEX "supplier_payments_org_supplier_idx" ON "supplier_payments" ("org_id", "supplier_id");--> statement-breakpoint

-- Tenant isolation (0038 shape) and grants ---------------------------------------------
ALTER TABLE "purchase_order_shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_shipments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "purchase_order_shipments_tenant_isolation" ON "purchase_order_shipments"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "purchase_order_shipment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_shipment_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "purchase_order_shipment_items_tenant_isolation" ON "purchase_order_shipment_items"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "supplier_payments_tenant_isolation" ON "supplier_payments"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "purchase_order_shipments", "purchase_order_shipment_items", "supplier_payments" TO "irth_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "purchase_order_shipments", "purchase_order_shipment_items", "supplier_payments" FROM "irth_app";--> statement-breakpoint

-- Supplier scope on the new tables (0076 shape) ----------------------------------------
CREATE POLICY "supplier_payments_supplier_scope" ON "supplier_payments" AS RESTRICTIVE
  USING (scope_ids('app.supplier_ids') IS NULL OR "supplier_id" = ANY (scope_ids('app.supplier_ids')))
  WITH CHECK (scope_ids('app.supplier_ids') IS NULL OR "supplier_id" = ANY (scope_ids('app.supplier_ids')));--> statement-breakpoint
CREATE POLICY "purchase_order_shipments_supplier_scope" ON "purchase_order_shipments" AS RESTRICTIVE
  USING (scope_ids('app.supplier_ids') IS NULL OR "po_id" IN (SELECT "id" FROM "purchase_orders"))
  WITH CHECK (scope_ids('app.supplier_ids') IS NULL OR "po_id" IN (SELECT "id" FROM "purchase_orders"));--> statement-breakpoint
CREATE POLICY "purchase_order_shipment_items_supplier_scope" ON "purchase_order_shipment_items" AS RESTRICTIVE
  USING (scope_ids('app.supplier_ids') IS NULL OR "shipment_id" IN (SELECT "id" FROM "purchase_order_shipments"))
  WITH CHECK (scope_ids('app.supplier_ids') IS NULL OR "shipment_id" IN (SELECT "id" FROM "purchase_order_shipments"));--> statement-breakpoint

-- A supplier account without a scope sees nothing (fail closed) ------------------------
CREATE FUNCTION "app_is_supplier"() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.principal_kind', true), '') = 'supplier'
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_is_supplier"() TO "irth_app";--> statement-breakpoint

CREATE POLICY "suppliers_supplier_principal" ON "suppliers" AS RESTRICTIVE
  USING (NOT app_is_supplier() OR scope_ids('app.supplier_ids') IS NOT NULL)
  WITH CHECK (NOT app_is_supplier() OR scope_ids('app.supplier_ids') IS NOT NULL);--> statement-breakpoint
CREATE POLICY "purchase_orders_supplier_principal" ON "purchase_orders" AS RESTRICTIVE
  USING (NOT app_is_supplier() OR scope_ids('app.supplier_ids') IS NOT NULL)
  WITH CHECK (NOT app_is_supplier() OR scope_ids('app.supplier_ids') IS NOT NULL);--> statement-breakpoint
CREATE POLICY "supplier_payments_supplier_principal" ON "supplier_payments" AS RESTRICTIVE
  USING (NOT app_is_supplier() OR scope_ids('app.supplier_ids') IS NOT NULL)
  WITH CHECK (NOT app_is_supplier() OR scope_ids('app.supplier_ids') IS NOT NULL);--> statement-breakpoint

-- The ledger is closed to supplier accounts --------------------------------------------
CREATE POLICY "journal_entries_no_supplier" ON "journal_entries" AS RESTRICTIVE
  USING (NOT app_is_supplier()) WITH CHECK (NOT app_is_supplier());--> statement-breakpoint
CREATE POLICY "journal_lines_no_supplier" ON "journal_lines" AS RESTRICTIVE
  USING (NOT app_is_supplier()) WITH CHECK (NOT app_is_supplier());--> statement-breakpoint

-- What a supplier is owed, per purchase order, read from the ledger (CLAUDE.md rule 2).
-- SECURITY DEFINER so it can read the ledger a supplier account cannot; it answers only
-- for the current org, and only for a supplier inside the caller's supplier scope —
-- a supplier account must have one; an unscoped staff member may ask about any.
--   received = payable credited by goods receipts sourced from that PO
--   paid     = payments recorded against that PO (unallocated payments: po_id NULL)
CREATE FUNCTION "supplier_statement"(p_supplier_id uuid)
  RETURNS TABLE (po_id uuid, received_minor bigint, paid_minor bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_scope uuid[] := scope_ids('app.supplier_ids');
BEGIN
  IF v_org IS NULL THEN RETURN; END IF;
  IF app_is_supplier() AND v_scope IS NULL THEN RETURN; END IF;
  IF v_scope IS NOT NULL AND NOT (p_supplier_id = ANY (v_scope)) THEN RETURN; END IF;
  RETURN QUERY
    WITH pos AS (
      SELECT po.id FROM purchase_orders po WHERE po.org_id = v_org AND po.supplier_id = p_supplier_id
    ),
    received AS (
      SELECT je.source_id AS po_id, SUM(jl.credit_minor - jl.debit_minor)::bigint AS amount
      FROM journal_entries je
      JOIN journal_lines jl ON jl.entry_id = je.id AND jl.org_id = v_org
      JOIN accounts a ON a.id = jl.account_id AND a.org_id = v_org AND a.code = '2010'
      WHERE je.org_id = v_org AND je.source_table = 'purchase_orders'
        AND je.source_id IN (SELECT id FROM pos)
      GROUP BY je.source_id
    ),
    paid AS (
      SELECT sp.po_id, SUM(sp.amount_minor)::bigint AS amount
      FROM supplier_payments sp
      WHERE sp.org_id = v_org AND sp.supplier_id = p_supplier_id
      GROUP BY sp.po_id
    )
    SELECT u.po_id, SUM(u.received)::bigint, SUM(u.paid)::bigint
    FROM (
      SELECT r.po_id, r.amount AS received, 0::bigint AS paid FROM received r
      UNION ALL
      SELECT p.po_id, 0::bigint, p.amount FROM paid p
    ) u
    GROUP BY u.po_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "supplier_statement"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "supplier_statement"(uuid) TO "irth_app";
