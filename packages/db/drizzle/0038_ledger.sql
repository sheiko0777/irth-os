-- The double-entry ledger: accounts, journal entries, journal lines, fiscal periods.
--
-- WHY THIS EXISTS
--
-- Every money-moving event in this system today writes directly to its own
-- table — orders.total_amount_minor, gift_cards.balance_minor,
-- courier_remittances.amount_minor — and nothing ties them together. finance.pnl
-- computes "profit" as SUM(orders.total_amount_minor) for delivered orders: no
-- COGS, no returns, no expenses. It is gross sales wearing a P&L's name.
--
-- A ledger does not replace those tables — orders still owns "what the customer
-- ordered", gift_cards still owns "what a card is worth right now". It adds a
-- second, independent record of the FINANCIAL CONSEQUENCE of each event, in the
-- one shape that is checkable by construction: every entry balances.
--
-- THREE GUARANTEES, NOT ONE
--
-- 1. A pure function (packages/db/src/ledger.ts, postJournalEntry) sums debits
--    and credits in JS and refuses to build an entry that does not balance,
--    before issuing a single statement. Convenience — it stops a bug in the
--    caller's arithmetic before it reaches the database at all.
-- 2. A DEFERRABLE CONSTRAINT TRIGGER on journal_lines re-derives the same sum
--    from the rows Postgres actually holds and rejects the transaction at
--    COMMIT if it does not balance. This is the real guarantee: it holds
--    regardless of what wrote the rows, catches a bug IN postJournalEntry
--    itself, and cannot be skipped by a caller that forgot to use it.
-- 3. No UPDATE or DELETE grant on journal_entries or journal_lines. A posted
--    entry cannot be edited or removed by the application role at all — only
--    inserted. A correction is a new entry with debits and credits swapped
--    (reverseJournalEntry), which is itself checked by guarantees 1 and 2.
--    Guarantee 2 stops an unbalanced entry; this stops a BALANCED but wrong
--    entry from being quietly rewritten after the fact.
--
-- Layered on purpose: (1) is the one a bug in application code trips over
-- immediately during development; (2) is the one that holds even if (1) is
-- wrong or bypassed; (3) is the one that holds even if someone with database
-- access tries to edit history directly.
--
-- WHAT THE PLAN LISTED THAT THIS DOES NOT BUILD
--
-- `journals` as a separate table is NOT built. This codebase's own convention
-- for closed vocabularies is a pg enum (order_status, movement_type,
-- gift_card_status) — not a lookup table with a handful of near-static rows.
-- A `journals` table would need its own org-scoping decision (is a "Sales
-- Journal" tenant data or shared reference data?) for no benefit over an enum,
-- so `journal_type` is a plain enum column on journal_entries instead.
--
-- `exchange_rates`, `tax_codes`, `tax_rates` are NOT built. Nothing in this
-- codebase reads or writes multi-currency conversion or a per-line tax code —
-- EGYPT_VAT_BP (packages/domain) is one flat 14% applied everywhere a VAT
-- figure is needed. Three tables nothing populates and nothing queries are not
-- infrastructure, they are guesses at a shape for a feature that does not
-- exist yet. When multi-currency or multi-rate VAT is a real requirement, the
-- shape should be designed against that requirement, not against this comment.

CREATE TYPE "ledger_account_type" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- Stored explicitly per account rather than derived from `type`, so a CONTRA
-- account can exist: "4020 Sales Returns & Allowances" is type=revenue (it
-- lives in the revenue section of a report) but normal_balance=debit (a return
-- reduces revenue, so its natural entries are debits). Deriving the balance
-- side from the type alone cannot express that.
CREATE TYPE "ledger_normal_balance" AS ENUM ('debit', 'credit');

-- The event categories a business event is posted under. A plain enum, not a
-- table — see the comment above on why `journals` is not a separate table.
CREATE TYPE "ledger_journal_type" AS ENUM ('sales', 'purchases', 'cash', 'inventory', 'general');

CREATE TYPE "ledger_period_status" AS ENUM ('open', 'closed');

CREATE TABLE "accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  -- Egyptian-style numeric code (1xxx assets, 2xxx liabilities, 3xxx equity,
  -- 4xxx revenue, 5xxx expenses). Text, not integer: codes are compared and
  -- displayed, never arithmetic on.
  "code" text NOT NULL,
  "name" text NOT NULL,
  "type" ledger_account_type NOT NULL,
  "normal_balance" ledger_normal_balance NOT NULL,
  -- Reference data, not immutable history: unlike journal_entries/lines below,
  -- an account can legitimately be renamed or deactivated. It carries no money
  -- itself — journal_lines does — so editing an account cannot rewrite what
  -- already posted against it.
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "accounts_org_code_key" UNIQUE ("org_id", "code"),
  -- Composite-FK target for journal_lines.account_id below — the same
  -- parent/child org-agreement trick as 0030's purchase_order_items.
  CONSTRAINT "accounts_id_org_key" UNIQUE ("id", "org_id")
);--> statement-breakpoint

CREATE TABLE "journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "journal_type" ledger_journal_type NOT NULL,
  -- The business date the event happened on, not necessarily now() — an order
  -- delivered yesterday and reconciled today should post dated yesterday.
  "entry_date" timestamp NOT NULL DEFAULT now(),
  "description" text NOT NULL,
  -- Polymorphic reference back to the business row that caused this entry
  -- ('orders', 'order_returns', 'purchase_orders', 'gift_cards',
  -- 'courier_remittances', 'stocktaking_sessions'). No FK — the referenced
  -- table varies, and the entry must survive even if the source row's own
  -- lifecycle changes. Traceability, not a join target.
  "source_table" text,
  "source_id" uuid,
  -- Set on a reversing entry; NULL on an original. Self-reference, and safe
  -- without an ON DELETE action because nothing can delete a journal_entries
  -- row at all (see the REVOKE below).
  "reversal_of" uuid REFERENCES "journal_entries"("id"),
  -- text, not uuid: Better Auth's user ids are random alphanumeric strings,
  -- not uuids (0034). A uuid column here would have carried the exact defect
  -- audit_log.user_id did before that migration.
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  -- Composite-FK target for journal_lines.entry_id below.
  CONSTRAINT "journal_entries_id_org_key" UNIQUE ("id", "org_id")
);--> statement-breakpoint

CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" ("org_id", "entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_org_source_idx" ON "journal_entries" ("org_id", "source_table", "source_id");--> statement-breakpoint

CREATE TABLE "journal_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised from journal_entries, same reasoning as 0030's child tables:
  -- RLS needs org_id on every row it scopes, and the composite FKs below make
  -- it impossible for a line to disagree with its parent entry or its account
  -- about which org owns it.
  "org_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "debit_minor" bigint NOT NULL DEFAULT 0,
  "credit_minor" bigint NOT NULL DEFAULT 0,
  "currency" char(3) NOT NULL DEFAULT 'EGP',
  "memo" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "journal_lines_entry_org_fkey" FOREIGN KEY ("entry_id", "org_id")
    REFERENCES "journal_entries" ("id", "org_id"),
  CONSTRAINT "journal_lines_account_org_fkey" FOREIGN KEY ("account_id", "org_id")
    REFERENCES "accounts" ("id", "org_id"),
  -- A line is a debit line XOR a credit line, never both, never neither.
  -- Convenience guarantee (1) in packages/db/src/ledger.ts enforces this
  -- before the insert; this CHECK enforces it regardless of what wrote the row.
  CONSTRAINT "journal_lines_side_check" CHECK (
    "debit_minor" >= 0 AND "credit_minor" >= 0
    AND (("debit_minor" > 0 AND "credit_minor" = 0) OR ("credit_minor" > 0 AND "debit_minor" = 0))
  )
);--> statement-breakpoint

CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_idx" ON "journal_lines" ("org_id", "account_id");--> statement-breakpoint

-- Guarantee 2: the deferred constraint trigger.
--
-- DEFERRABLE INITIALLY DEFERRED, not a plain trigger: an entry with N lines is
-- inserted as N statements in one transaction, and the sum is only meaningful
-- once all of them exist. A plain (non-deferred) trigger would reject the
-- first line the instant it landed, before the balancing line ever arrived. A
-- deferred trigger runs at COMMIT (or an explicit SET CONSTRAINTS ALL
-- IMMEDIATE), by which point every line for every entry touched in the
-- transaction is present.
--
-- Fires once per row change (AAFTER INSERT/UPDATE/DELETE, FOR EACH ROW) and
-- re-sums from the table itself each time — it does not trust the row that
-- triggered it, or anything computed in application code. Re-summing per row
-- for a multi-line entry is redundant work but not redundant safety: every
-- firing is an independent, correct check.
CREATE OR REPLACE FUNCTION "check_journal_entry_balanced"() RETURNS trigger AS $$
DECLARE
  v_entry_id uuid;
  v_debit bigint;
  v_credit bigint;
BEGIN
  v_entry_id := COALESCE(NEW."entry_id", OLD."entry_id");

  SELECT COALESCE(SUM("debit_minor"), 0), COALESCE(SUM("credit_minor"), 0)
    INTO v_debit, v_credit
    FROM "journal_lines"
    WHERE "entry_id" = v_entry_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal_entry % is unbalanced: debit=% credit=%', v_entry_id, v_debit, v_credit
      USING ERRCODE = '23514'; -- check_violation, so callers can catch it the same way as any other CHECK
  END IF;

  RETURN NULL; -- ignored on an AFTER trigger
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_journal_entry_balanced"();--> statement-breakpoint

-- Guarantee 3: journal_entries and journal_lines are insert-only for the app.
--
-- 0031's `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON
-- TABLES TO irth_app` applies to every table created after it — including
-- these two, automatically, the moment CREATE TABLE ran above. Without this
-- explicit REVOKE, irth_app would already hold UPDATE and DELETE on both, and
-- guarantee 3 would not exist despite every comment above claiming it does.
REVOKE UPDATE, DELETE ON "journal_entries", "journal_lines" FROM "irth_app";--> statement-breakpoint

-- fiscal_periods: closes a date range against new postings.
--
-- No period-close UI exists yet, so this ships permissive: postJournalEntry
-- checks whether a CLOSED period covers the entry's date and refuses if so;
-- if no period row covers the date at all, posting proceeds. Fail-open on
-- absence, fail-closed on an explicit close — the alternative (requiring a
-- period to exist before anything can post) would block every ledger write
-- until someone builds period management, for a control nothing needs yet.
CREATE TABLE "fiscal_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" ledger_period_status NOT NULL DEFAULT 'open',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "fiscal_periods_dates_check" CHECK ("end_date" >= "start_date")
);--> statement-breakpoint

CREATE INDEX "fiscal_periods_org_dates_idx" ON "fiscal_periods" ("org_id", "start_date", "end_date");--> statement-breakpoint

-- RLS on all four. Not inherited: the loop in 0031 ran once, over the tables
-- that existed then. A tenant table added later gets nothing unless its own
-- migration says so — the same note as every ledger-adjacent migration since.
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "accounts_tenant_isolation" ON "accounts"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "journal_entries_tenant_isolation" ON "journal_entries"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "journal_lines_tenant_isolation" ON "journal_lines"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

ALTER TABLE "fiscal_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fiscal_periods_tenant_isolation" ON "fiscal_periods"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

-- Explicit grants, matching 0036/0037's reasoning: the ALTER DEFAULT PRIVILEGES
-- rule from 0031 already covers newly created tables, but stating it here
-- means this migration is correct read on its own, without cross-referencing
-- 0031 to know whether irth_app can reach these tables at all.
GRANT SELECT, INSERT ON "accounts" TO "irth_app";--> statement-breakpoint
GRANT UPDATE ON "accounts" TO "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "journal_entries" TO "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "journal_lines" TO "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fiscal_periods" TO "irth_app";
