-- 0086: orders v2, PR A — DM-05 ⊕ OR-09 merged (spec §7.0), ADDITIVE ONLY.
--
-- Every existing writer keeps working unchanged: nothing is dropped or
-- renamed, every new orders column is nullable or has a default, and the
-- legacy `status` enum, `shopify_order_id` and `total_amount_minor` stay. PR B
-- moves the writers over and drops the legacy columns.
--
-- 1. orders: provider identity (connection_id, source*, accepted /
--    pending-revision candidate), money parity (fees/refunded/outstanding,
--    presentment currency, taxes_included), provider statuses, tags /
--    attributes / risk, cancel/close/hold, the 11-key `sections` map, and five
--    lifecycles (commercial / fulfillment / payment / invoice / settlement) as
--    CHECKed text, backfilled from the legacy `status` enum below.
--
-- 2. Promotion guard: an order with a source must have come through an
--    accepted candidate — CHECK (source IS NULL OR source = 'legacy_shopify'
--    OR accepted_candidate_id IS NOT NULL). Rows imported by the pre-candidate
--    Shopify webhook (shopify_order_id set) predate candidates and have none
--    to point at, so they are backfilled as 'legacy_shopify', not 'shopify';
--    an order promoted through OR-10 uses 'shopify' and must carry its
--    candidate. Dashboard orders keep source NULL and are untouched.
--
-- 3. orders_items_match_candidate: a DEFERRABLE INITIALLY DEFERRED constraint
--    trigger. At COMMIT, an order whose accepted_candidate_id was set in the
--    transaction must have exactly candidate.line_count order_items rows, so
--    a promotion cannot commit a header with a partial item set. Header and
--    items may be written in any order inside the transaction.
--
-- 4. order_items: line_kind mapped|custom_nonstock; variant_id becomes
--    NULLABLE, but only for custom_nonstock lines (a CHECK ties the two), so a
--    mapped line can still never lose its variant. Source line identity and
--    per-line money / quantity snapshots. price_minor stays (rename is PR B).
--
-- 5. order_source_transactions / _refunds / _fulfillments: the provider's
--    child records, one row per (order_id, source_id), same-org composite FK
--    onto orders(id, org_id) (orders_id_org_id_key, 0077). RLS ENABLE + FORCE
--    with the NULLIF tenant policy, GRANT to irth_app.

-- ---------------------------------------------------------------- orders ----

ALTER TABLE "order_import_candidates"
  ADD CONSTRAINT "order_import_candidates_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint

ALTER TABLE "orders"
  ADD COLUMN "connection_id" uuid REFERENCES "shopify_connections"("id"),
  ADD COLUMN "source" text,
  ADD COLUMN "source_order_id" text,
  ADD COLUMN "source_order_number" text,
  ADD COLUMN "source_created_at" timestamptz,
  ADD COLUMN "source_updated_at" timestamptz,
  ADD COLUMN "source_synced_at" timestamptz,
  ADD COLUMN "accepted_candidate_id" uuid,
  ADD COLUMN "pending_revision_candidate_id" uuid,
  ADD COLUMN "presentment_currency" char(3),
  ADD COLUMN "fees_minor" bigint,
  ADD COLUMN "refunded_minor" bigint,
  ADD COLUMN "outstanding_minor" bigint,
  ADD COLUMN "taxes_included" boolean,
  ADD COLUMN "source_financial_status" text,
  ADD COLUMN "source_fulfillment_status" text,
  ADD COLUMN "tags" text[],
  ADD COLUMN "custom_attributes" jsonb,
  ADD COLUMN "risk" jsonb,
  ADD COLUMN "source_url" text,
  ADD COLUMN "is_test" boolean NOT NULL DEFAULT false,
  ADD COLUMN "cancel_reason" text,
  ADD COLUMN "cancelled_at" timestamptz,
  ADD COLUMN "closed_at" timestamptz,
  ADD COLUMN "sections" jsonb,
  ADD COLUMN "hold_reason" text,
  ADD COLUMN "held_at" timestamptz,
  ADD COLUMN "held_by" text,
  ADD COLUMN "commercial_status" text NOT NULL DEFAULT 'open',
  ADD COLUMN "fulfillment_status" text NOT NULL DEFAULT 'unfulfilled',
  ADD COLUMN "payment_status" text NOT NULL DEFAULT 'pending',
  ADD COLUMN "invoice_status" text NOT NULL DEFAULT 'not_required',
  ADD COLUMN "settlement_status" text NOT NULL DEFAULT 'unsettled',
  -- Same-org: a candidate of another org can never be an order's source.
  ADD CONSTRAINT "orders_accepted_candidate_same_org_fk"
    FOREIGN KEY ("accepted_candidate_id", "org_id") REFERENCES "order_import_candidates"("id", "org_id"),
  ADD CONSTRAINT "orders_pending_revision_candidate_same_org_fk"
    FOREIGN KEY ("pending_revision_candidate_id", "org_id") REFERENCES "order_import_candidates"("id", "org_id"),
  ADD CONSTRAINT "orders_commercial_status_check"
    CHECK ("commercial_status" IN ('open', 'cancelled', 'closed')),
  ADD CONSTRAINT "orders_fulfillment_status_check"
    CHECK ("fulfillment_status" IN ('unfulfilled', 'partial', 'shipped', 'delivered', 'returned')),
  ADD CONSTRAINT "orders_payment_status_check"
    CHECK ("payment_status" IN ('pending', 'cod_pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'voided', 'failed')),
  ADD CONSTRAINT "orders_invoice_status_check"
    CHECK ("invoice_status" IN ('not_required', 'pending', 'issued', 'failed')),
  ADD CONSTRAINT "orders_settlement_status_check"
    CHECK ("settlement_status" IN ('unsettled', 'partial', 'settled')),
  ADD CONSTRAINT "orders_sections_check"
    CHECK ("sections" IS NULL OR (jsonb_typeof("sections") = 'object' AND "sections" ?& ARRAY[
      'identity', 'items', 'buyer', 'addresses', 'price', 'currency',
      'payment', 'fulfillment', 'returns', 'context', 'evidence']));--> statement-breakpoint

COMMENT ON COLUMN "orders"."connection_id" IS
  'Still REFERENCES shopify_connections(id); CX-12 repoints it to connections(id, org_id).';--> statement-breakpoint

-- Backfill from the legacy columns. Derivations (status enum = pending |
-- confirmed | payment_failed | shipped | delivered | cancelled):
--   commercial   cancelled -> cancelled; everything else -> open
--   fulfillment  shipped -> shipped; delivered -> delivered; else unfulfilled
--   payment      payment_failed -> failed; cancelled -> voided;
--                COD: delivered -> paid (collected on the doorstep), else
--                cod_pending; online: confirmed/shipped/delivered -> paid
--                (an online order is confirmed by its payment), else pending
--   invoice      from eta_invoices: valid -> issued; rejected/error -> failed;
--                pending/submitted -> pending; no invoice -> not_required
--   settlement   unsettled for every row: nothing on the legacy row records a
--                courier / gateway remittance.
UPDATE "orders" SET
  "commercial_status" = CASE WHEN "status" = 'cancelled' THEN 'cancelled' ELSE 'open' END,
  "fulfillment_status" = CASE "status"
    WHEN 'shipped' THEN 'shipped'
    WHEN 'delivered' THEN 'delivered'
    ELSE 'unfulfilled' END,
  "payment_status" = CASE
    WHEN "status" = 'payment_failed' THEN 'failed'
    WHEN "status" = 'cancelled' THEN 'voided'
    WHEN "payment_method" = 'cod' THEN CASE WHEN "status" = 'delivered' THEN 'paid' ELSE 'cod_pending' END
    WHEN "payment_method" = 'online' AND "status" IN ('confirmed', 'shipped', 'delivered') THEN 'paid'
    ELSE 'pending' END;--> statement-breakpoint

UPDATE "orders" o SET "invoice_status" = CASE e."status"
    WHEN 'valid' THEN 'issued'
    WHEN 'rejected' THEN 'failed'
    WHEN 'error' THEN 'failed'
    WHEN 'pending' THEN 'pending'
    WHEN 'submitted' THEN 'pending'
    ELSE 'not_required' END
  FROM "eta_invoices" e
 WHERE e."order_id" = o."id" AND e."org_id" = o."org_id";--> statement-breakpoint

-- Pre-candidate Shopify imports: 'legacy_shopify', see note 2 above.
UPDATE "orders" SET "source" = 'legacy_shopify', "source_order_id" = "shopify_order_id"
 WHERE "shopify_order_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_guard_check"
  CHECK ("source" IS NULL OR "source" = 'legacy_shopify' OR "accepted_candidate_id" IS NOT NULL);--> statement-breakpoint

-- A NULL connection_id never equals another, so legacy rows (no connection
-- yet) are not deduplicated here; orders_org_id_shopify_order_id_idx still
-- covers them.
CREATE UNIQUE INDEX "orders_connection_source_order_idx"
  ON "orders" ("connection_id", "source_order_id") WHERE "source_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_accepted_candidate_idx"
  ON "orders" ("accepted_candidate_id") WHERE "accepted_candidate_id" IS NOT NULL;--> statement-breakpoint

-- ----------------------------------------------------------- order_items ----

ALTER TABLE "order_items"
  ADD COLUMN "line_kind" text NOT NULL DEFAULT 'mapped',
  ADD COLUMN "source_line_id" text,
  ADD COLUMN "title" text,
  ADD COLUMN "variant_title" text,
  ADD COLUMN "sku_snapshot" text,
  ADD COLUMN "source_variant_id" text,
  ADD COLUMN "source_product_id" text,
  ADD COLUMN "current_quantity" integer,
  ADD COLUMN "unfulfilled_quantity" integer,
  ADD COLUMN "refundable_quantity" integer,
  ADD COLUMN "discount_minor" bigint,
  ADD COLUMN "tax_minor" bigint,
  ADD COLUMN "total_minor" bigint,
  ADD COLUMN "requires_shipping" boolean,
  ADD COLUMN "custom_attributes" jsonb,
  ADD COLUMN "tax_lines" jsonb,
  ADD COLUMN "discount_allocations" jsonb,
  ALTER COLUMN "variant_id" DROP NOT NULL,
  ADD CONSTRAINT "order_items_line_kind_check"
    CHECK ("line_kind" IN ('mapped', 'custom_nonstock')),
  -- Only a custom, non-stock line (a provider line with no product behind it:
  -- a gift-wrap fee, a custom item) may lack a variant, and it must.
  ADD CONSTRAINT "order_items_variant_matches_kind_check"
    CHECK (("line_kind" = 'custom_nonstock') = ("variant_id" IS NULL));--> statement-breakpoint

CREATE UNIQUE INDEX "order_items_order_source_line_idx"
  ON "order_items" ("order_id", "source_line_id") WHERE "source_line_id" IS NOT NULL;--> statement-breakpoint

-- ------------------------------------------- commit-time completeness ----

-- SECURITY INVOKER: it runs as whoever committed, under that role's RLS. Both
-- lookups also filter on the order's org_id, so it never counts across orgs
-- even for a role that bypasses RLS. It re-reads the order's CURRENT
-- accepted_candidate_id rather than trusting NEW: a later statement in the
-- same transaction may have changed or deleted the row.
CREATE FUNCTION "orders_items_match_candidate"() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_candidate uuid;
  v_expected integer;
  v_actual integer;
BEGIN
  SELECT accepted_candidate_id INTO v_candidate
    FROM orders WHERE id = NEW.id AND org_id = NEW.org_id;
  IF v_candidate IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT line_count INTO v_expected
    FROM order_import_candidates WHERE id = v_candidate AND org_id = NEW.org_id;
  SELECT count(*)::integer INTO v_actual
    FROM order_items WHERE order_id = NEW.id AND org_id = NEW.org_id;
  IF v_expected IS NULL OR v_actual <> v_expected THEN
    RAISE EXCEPTION 'order % has % order_items but its accepted candidate % expects % (line_count)',
      NEW.id, v_actual, v_candidate, coalesce(v_expected::text, 'unknown')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'orders_items_match_candidate';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders_items_match_candidate"() FROM PUBLIC;--> statement-breakpoint
-- ponytail: fires on the order row only. Deleting items from an already
-- promoted order in a later transaction is not re-checked; add an AFTER
-- DELETE trigger on order_items when anything edits promoted items.
CREATE CONSTRAINT TRIGGER "orders_items_match_candidate"
  AFTER INSERT OR UPDATE OF "accepted_candidate_id" ON "orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "orders_items_match_candidate"();--> statement-breakpoint

-- -------------------------------------------- provider child records ----

CREATE TABLE "order_source_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "order_id" uuid NOT NULL,
  "source_id" text NOT NULL,
  "kind" text,
  "status" text,
  "gateway" text,
  "amount_minor" bigint,
  "currency" char(3),
  "parent_source_id" text,
  "processed_at" timestamptz,
  "raw" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_source_transactions_order_same_org_fk"
    FOREIGN KEY ("order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  CONSTRAINT "order_source_transactions_order_source_key" UNIQUE ("order_id", "source_id")
);--> statement-breakpoint

CREATE TABLE "order_source_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "order_id" uuid NOT NULL,
  "source_id" text NOT NULL,
  "note" text,
  "total_minor" bigint,
  "line_items" jsonb,
  "transaction_source_ids" text[],
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_source_refunds_order_same_org_fk"
    FOREIGN KEY ("order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  CONSTRAINT "order_source_refunds_order_source_key" UNIQUE ("order_id", "source_id")
);--> statement-breakpoint

CREATE TABLE "order_source_fulfillments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "order_id" uuid NOT NULL,
  "source_id" text NOT NULL,
  "status" text,
  "tracking" jsonb,
  "line_items" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_source_fulfillments_order_same_org_fk"
    FOREIGN KEY ("order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  CONSTRAINT "order_source_fulfillments_order_source_key" UNIQUE ("order_id", "source_id")
);--> statement-breakpoint

-- RLS: same NULLIF shape as 0050/0052/0083/0084/0085.
ALTER TABLE "order_source_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_source_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "order_source_transactions_tenant_isolation" ON "order_source_transactions"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_source_transactions" TO irth_app;--> statement-breakpoint

ALTER TABLE "order_source_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_source_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "order_source_refunds_tenant_isolation" ON "order_source_refunds"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_source_refunds" TO irth_app;--> statement-breakpoint

ALTER TABLE "order_source_fulfillments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_source_fulfillments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "order_source_fulfillments_tenant_isolation" ON "order_source_fulfillments"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_source_fulfillments" TO irth_app;
