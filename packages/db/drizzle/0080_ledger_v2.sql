-- 0080: ledger v2 — legal entity, analytic dimensions, functional-currency balance (DM-03).
--
-- WHY THIS EXISTS
--
-- 0038 built a single-entity, single-currency ledger: one chart of accounts per
-- org, every entry in one currency, the balance trigger summing debit_minor /
-- credit_minor. DM-01 (0069) gave the org legal entities (each with a
-- functional currency), brands, channels and warehouses; DM-02 (0070) gave it
-- exchange rates. This file makes the ledger speak that model:
--
--   accounts        belong to a legal entity: UNIQUE (org, entity, code). Each
--                   entity has its own chart (ensureChartOfAccounts per entity).
--   journal_entries belong to a legal entity and carry an entry_kind, so one
--                   business event cannot be posted twice for the same source.
--   journal_lines   carry the entity (composite FKs to the entry AND the
--                   account, so a line can never mix entities), the amount in
--                   the entity's functional currency with the rate used, and
--                   analytic dimensions (brand, channel, warehouse, variant,
--                   order, counterparty).
--   fiscal_periods  close per entity.
--
-- THE THREE GUARANTEES, SAME ORDER AS 0038
--
-- 1. postJournalEntry (packages/db/src/ledger.ts) still refuses a malformed or
--    unbalanced entry before any INSERT. It now balances in FUNCTIONAL currency,
--    so a mixed-currency entry is legal as long as it balances once converted.
-- 2. check_journal_entry_balanced is re-pointed at functional_debit_minor /
--    functional_credit_minor (and refuses an entry mixing functional
--    currencies). Still a DEFERRABLE INITIALLY DEFERRED constraint trigger.
-- 3. REVOKE UPDATE, DELETE on journal_entries / journal_lines is restated below.
--
-- BACKFILL
--
-- Every existing account / entry / line / fiscal period gets the org's default
-- entity (organizations.stock_owner_entity_id, seeded by 0069). Functional
-- amounts = transaction amounts, fx 1/1 — every existing row is EGP and the
-- seeded entity is EGP, so nothing is converted. Revenue/COGS lines get the
-- default channel's brand + channel so they satisfy REQUIRED_DIMENSIONS when
-- reversed. Existing rows get an entry_kind derived from source_table; where
-- that would collide under the new once-per-source index (dev/test data only —
-- production has no journal rows), the later duplicates become 'manual'.
-- Works on an empty database (every UPDATE touches zero rows).
--
-- RLS: no policy on these four tables is dropped or recreated. 0038's tenant
-- policies and 0079's restrictive *_no_supplier policies do not reference any
-- column changed here, so they stand as they are.

CREATE TYPE "ledger_entry_kind" AS ENUM (
  'order_delivered', 'return_refund', 'return_restock',
  'gift_card_issued', 'gift_card_redeemed',
  'po_receipt', 'supplier_payment', 'courier_remittance',
  'rep_collection', 'rep_handover', 'rep_shortage_writeoff',
  'stocktake_variance', 'reversal', 'manual', 'intercompany', 'fx_revaluation'
);--> statement-breakpoint
CREATE TYPE "ledger_counterparty_kind" AS ENUM ('customer', 'supplier', 'courier', 'member', 'legal_entity');--> statement-breakpoint

-- Any org that somehow lost its default entity gets one (same loop as 0069).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM organizations WHERE stock_owner_entity_id IS NULL LOOP
    PERFORM seed_org_dimensions(r.id);
  END LOOP;
END $$;--> statement-breakpoint

-- accounts ---------------------------------------------------------------------------
ALTER TABLE "accounts" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
UPDATE "accounts" a SET "legal_entity_id" = o."stock_owner_entity_id"
  FROM "organizations" o WHERE o."id" = a."org_id";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_entity_same_org_fk"
  FOREIGN KEY ("legal_entity_id", "org_id") REFERENCES "legal_entities"("id", "org_id");--> statement-breakpoint
-- A code is unique per entity now, not per org: each entity has its own chart.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_org_code_key";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_entity_code_key" UNIQUE ("org_id", "legal_entity_id", "code");--> statement-breakpoint
-- Composite-FK target for journal_lines (account_id, legal_entity_id).
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_entity_key" UNIQUE ("id", "legal_entity_id");--> statement-breakpoint

-- journal_entries --------------------------------------------------------------------
ALTER TABLE "journal_entries" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "entry_kind" "ledger_entry_kind";--> statement-breakpoint
UPDATE "journal_entries" je SET "legal_entity_id" = o."stock_owner_entity_id"
  FROM "organizations" o WHERE o."id" = je."org_id";--> statement-breakpoint
UPDATE "journal_entries" SET "entry_kind" = (CASE
    WHEN "reversal_of" IS NOT NULL THEN 'reversal'
    WHEN "source_table" = 'orders' THEN 'order_delivered'
    WHEN "source_table" = 'order_returns' THEN 'return_refund'
    WHEN "source_table" = 'return_items' THEN 'return_restock'
    WHEN "source_table" = 'gift_cards' AND "description" LIKE 'Gift card redeemed%' THEN 'gift_card_redeemed'
    WHEN "source_table" = 'gift_cards' THEN 'gift_card_issued'
    WHEN "source_table" = 'purchase_orders' THEN 'po_receipt'
    WHEN "source_table" = 'supplier_payments' THEN 'supplier_payment'
    WHEN "source_table" = 'courier_remittances' THEN 'courier_remittance'
    WHEN "source_table" = 'rep_cash_collections' THEN 'rep_collection'
    WHEN "source_table" = 'rep_cash_handovers' AND "journal_type" = 'general' THEN 'rep_shortage_writeoff'
    WHEN "source_table" = 'rep_cash_handovers' THEN 'rep_handover'
    WHEN "source_table" = 'stocktaking_sessions' THEN 'stocktake_variance'
    ELSE 'manual'
  END)::"ledger_entry_kind";--> statement-breakpoint
-- Demote all but the earliest of any would-be duplicate so the index below can
-- be built on dev/test data that predates it.
UPDATE "journal_entries" je SET "entry_kind" = 'manual'
  FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "org_id", "legal_entity_id", "source_table", "source_id", "entry_kind"
      ORDER BY "created_at", "id") AS rn
    FROM "journal_entries"
    WHERE "reversal_of" IS NULL AND "source_id" IS NOT NULL
      AND "entry_kind" NOT IN ('po_receipt', 'gift_card_redeemed', 'manual')
  ) d
  WHERE d."id" = je."id" AND d.rn > 1;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "entry_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_entity_same_org_fk"
  FOREIGN KEY ("legal_entity_id", "org_id") REFERENCES "legal_entities"("id", "org_id");--> statement-breakpoint
-- Composite-FK target for journal_lines (entry_id, legal_entity_id).
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_id_entity_key" UNIQUE ("id", "legal_entity_id");--> statement-breakpoint
-- One original posting per (source, kind) per entity. Reversals are excluded
-- (reversal_of IS NOT NULL), and so are the kinds that legitimately repeat for
-- one source row: a PO received in several deliveries, a gift card redeemed
-- several times, and free-form manual entries.
CREATE UNIQUE INDEX "journal_entries_source_kind_once"
  ON "journal_entries" ("org_id", "legal_entity_id", "source_table", "source_id", "entry_kind")
  WHERE "reversal_of" IS NULL AND "entry_kind" NOT IN ('po_receipt', 'gift_card_redeemed', 'manual');--> statement-breakpoint

-- journal_lines ----------------------------------------------------------------------
-- The balance trigger also fires on UPDATE. Disabled for the backfill (which
-- copies txn amounts into functional, so balance is preserved by construction)
-- and re-enabled below in this same transaction.
ALTER TABLE "journal_lines" DISABLE TRIGGER "journal_lines_balanced";--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "functional_currency" char(3);--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "functional_debit_minor" bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "functional_credit_minor" bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "fx_rate_num" bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "fx_rate_den" bigint;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
-- variant_id / order_id: analytic tags with no FK, for the same reason
-- source_id has none — the ledger row must outlive the business row's own
-- lifecycle, and nothing may block on it.
ALTER TABLE "journal_lines" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "counterparty_kind" "ledger_counterparty_kind";--> statement-breakpoint
-- text, not uuid: a 'member' counterparty is a Better Auth user id (0034).
ALTER TABLE "journal_lines" ADD COLUMN "counterparty_id" text;--> statement-breakpoint
UPDATE "journal_lines" jl SET
    "legal_entity_id" = je."legal_entity_id",
    "functional_currency" = jl."currency",
    "functional_debit_minor" = jl."debit_minor",
    "functional_credit_minor" = jl."credit_minor",
    "fx_rate_num" = 1,
    "fx_rate_den" = 1
  FROM "journal_entries" je WHERE je."id" = jl."entry_id";--> statement-breakpoint
-- Revenue / COGS lines get the entity's default channel (and its brand), the
-- same one postJournalEntry's defaultChannel option resolves.
UPDATE "journal_lines" jl SET "brand_id" = ch."brand_id", "channel_id" = ch."id"
  FROM "accounts" a,
       (
         SELECT DISTINCT ON (c."org_id", c."selling_entity_id")
                c."org_id", c."selling_entity_id", c."id", c."brand_id"
         FROM "channels" c
         WHERE c."is_active"
         ORDER BY c."org_id", c."selling_entity_id", (c."code" = 'shopify-main') DESC, c."created_at", c."id"
       ) ch
  WHERE a."id" = jl."account_id" AND a."code" IN ('4010', '4020', '4030', '5010', '5040')
    AND ch."org_id" = jl."org_id" AND ch."selling_entity_id" = jl."legal_entity_id"
    AND jl."channel_id" IS NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "functional_currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "functional_debit_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "functional_credit_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "fx_rate_num" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "fx_rate_den" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE TRIGGER "journal_lines_balanced";--> statement-breakpoint
-- The line's entity must be its entry's entity AND its account's entity.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_entity_fkey"
  FOREIGN KEY ("entry_id", "legal_entity_id") REFERENCES "journal_entries" ("id", "legal_entity_id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_entity_fkey"
  FOREIGN KEY ("account_id", "legal_entity_id") REFERENCES "accounts" ("id", "legal_entity_id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_brand_same_org_fk"
  FOREIGN KEY ("brand_id", "org_id") REFERENCES "brands" ("id", "org_id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_channel_same_org_fk"
  FOREIGN KEY ("channel_id", "org_id") REFERENCES "channels" ("id", "org_id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_warehouse_same_org_fk"
  FOREIGN KEY ("warehouse_id", "org_id") REFERENCES "warehouses" ("id", "org_id");--> statement-breakpoint
-- 0038's side rule, applied to the functional pair too, and both pairs on the
-- same side: a txn debit is a functional debit.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_functional_side_check" CHECK (
  "functional_debit_minor" >= 0 AND "functional_credit_minor" >= 0
  AND (("functional_debit_minor" > 0 AND "functional_credit_minor" = 0)
    OR ("functional_credit_minor" > 0 AND "functional_debit_minor" = 0))
  AND ("debit_minor" > 0) = ("functional_debit_minor" > 0)
);--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_fx_rate_positive_check"
  CHECK ("fx_rate_num" > 0 AND "fx_rate_den" > 0);--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_counterparty_pair_check"
  CHECK (("counterparty_kind" IS NULL) = ("counterparty_id" IS NULL));--> statement-breakpoint
CREATE INDEX "journal_lines_org_entity_account_idx" ON "journal_lines" ("org_id", "legal_entity_id", "account_id");--> statement-breakpoint

-- fiscal_periods ---------------------------------------------------------------------
ALTER TABLE "fiscal_periods" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
UPDATE "fiscal_periods" fp SET "legal_entity_id" = o."stock_owner_entity_id"
  FROM "organizations" o WHERE o."id" = fp."org_id";--> statement-breakpoint
ALTER TABLE "fiscal_periods" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_entity_same_org_fk"
  FOREIGN KEY ("legal_entity_id", "org_id") REFERENCES "legal_entities"("id", "org_id");--> statement-breakpoint
CREATE INDEX "fiscal_periods_org_entity_dates_idx" ON "fiscal_periods" ("org_id", "legal_entity_id", "start_date", "end_date");--> statement-breakpoint

-- Guarantee 2, re-pointed at the functional columns. Same name, same trigger,
-- same ERRCODE: only the sum changed. An entry whose lines disagree about the
-- functional currency is refused too — their functional amounts would not be
-- the same unit, so their sum would mean nothing.
CREATE OR REPLACE FUNCTION "check_journal_entry_balanced"() RETURNS trigger AS $$
DECLARE
  v_entry_id uuid;
  v_debit bigint;
  v_credit bigint;
  v_currencies integer;
BEGIN
  v_entry_id := COALESCE(NEW."entry_id", OLD."entry_id");

  SELECT COALESCE(SUM("functional_debit_minor"), 0), COALESCE(SUM("functional_credit_minor"), 0),
         COUNT(DISTINCT "functional_currency")
    INTO v_debit, v_credit, v_currencies
    FROM "journal_lines"
    WHERE "entry_id" = v_entry_id;

  IF v_currencies > 1 THEN
    RAISE EXCEPTION 'journal_entry % mixes functional currencies', v_entry_id
      USING ERRCODE = '23514';
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal_entry % is unbalanced in functional currency: debit=% credit=%', v_entry_id, v_debit, v_credit
      USING ERRCODE = '23514'; -- check_violation, same as 0038
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Guarantee 3, restated: insert-only for the app role.
REVOKE UPDATE, DELETE ON "journal_entries", "journal_lines" FROM "irth_app";--> statement-breakpoint

-- supplier_statement (0079) reads functional amounts. Identical numbers for
-- single-currency data (functional = txn, fx 1/1).
CREATE OR REPLACE FUNCTION "supplier_statement"(p_supplier_id uuid)
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
      SELECT je.source_id AS po_id, SUM(jl.functional_credit_minor - jl.functional_debit_minor)::bigint AS amount
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
