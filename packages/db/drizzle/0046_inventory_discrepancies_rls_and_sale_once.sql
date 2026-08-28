-- 0046: two fixes that share one migration because both close holes opened by
-- the same blind spot — nothing in CI asserted RLS coverage, and nothing
-- asserted that a delivered order books its sale exactly once.

-- ---------------------------------------------------------------------------
-- 1. RLS for inventory_discrepancies
-- ---------------------------------------------------------------------------
-- 0045 created this table with `org_id uuid NOT NULL` and two org-scoped
-- indexes, and enabled no RLS and created no policy. RLS is NOT inherited:
-- 0031's catalogue loop ran once, over the tables that existed then, as 0037's
-- own comment already noted when it hit the same trap. 0045 is the newest
-- migration, so nothing since has covered it.
--
-- That left CLAUDE.md rule 3's second layer missing on this table: the queries
-- are scoped by org_id, but the database was not enforcing it independently.
-- The accompanying rlsCoverage integration test now fails on any future table
-- that repeats this, so the loop does not have to be remembered.
ALTER TABLE "inventory_discrepancies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_discrepancies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- NULLIF, matching 0032: current_setting(name, true) yields '' rather than NULL
-- once anything has set it on that backend, and ''::uuid raises 22P02 on every
-- query.
CREATE POLICY "inventory_discrepancies_tenant_isolation" ON "inventory_discrepancies"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_discrepancies" TO "irth_app";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. An order books its sale at most once
-- ---------------------------------------------------------------------------
-- Until this migration only ONE of the three delivered-transition paths posted
-- revenue (the tRPC router); the API route and the Bosta webhook posted
-- nothing. Wiring the other two to the shared postOrderDeliveredEntry fixes the
-- under-posting but makes OVER-posting reachable for the first time: every one
-- of those paths reads the order, then updates it, and none of the UPDATEs
-- carries a ne(status,'delivered') clause. A courier webhook racing a manual
-- PATCH can have both callers observe 'shipped' and both post a sale.
--
-- The application guard inside postOrderDeliveredEntry is the `if` above the
-- query that CLAUDE.md rule 5 warns is not enough on its own. This index is the
-- part the database enforces: a second sales entry for the same order raises
-- 23505 and rolls back the transaction that tried it, rather than silently
-- doubling revenue.
--
-- Partial, so it constrains nothing else: reversing entries carry
-- source_table = 'journal_entries' (see reverseJournalEntry), returns post
-- their own journal_type, and every non-order source is untouched.
CREATE UNIQUE INDEX "journal_entries_order_sale_once"
  ON "journal_entries" ("org_id", "source_id")
  WHERE "source_table" = 'orders' AND "journal_type" = 'sales';
