-- 0051: enforce what 0049 and 0050 asserted but did not actually guarantee.
--
-- Review of 0049/0050 (PR #216, already merged) raised three defects. All three
-- were reproduced against a real Postgres 16 before this file was written —
-- none is theoretical, and each is the same failure class those migrations
-- existed to fix: a file claiming a guarantee its SQL does not have.
--
-- 1. UNQUALIFIED DDL IN 0050's LOOP
--
--    0050 checks that each table exists in `public`, then executes
--    `ALTER TABLE %I` unqualified — so the check and the write can resolve to
--    different tables. scripts/migrate.mjs sets no search_path, so whatever
--    the role's default is decides. Measured, with a `shadow` schema ahead of
--    `public` on search_path:
--
--      public.shopify_connections  rls=false forced=false   <- still exposed
--      shadow.shopify_connections  rls=true  forced=true    <- got the policy
--
--    The migration would report success having protected the wrong table.
--
-- 2. `CREATE UNIQUE INDEX IF NOT EXISTS` VALIDATES ONLY THE NAME
--
--    IF NOT EXISTS was added to 0049 so a renumbering could not abort CI. But
--    Postgres skips creation when ANY relation of that name exists, without
--    comparing definitions. Measured: replace the index with a plain
--    non-unique `(org_id)` index of the same name, re-run 0049 —
--
--      applied  0049_inventory_discrepancies_rls_and_sale_once.sql
--      INSERT 0 2      <- two sales entries, same order, both accepted
--
--    The runner records the migration as applied while one-sale-per-order is
--    not enforced at all. That is strictly worse than the bare CREATE it
--    replaced, which at least failed loudly.
--
-- 3. NULL source_id ESCAPES THE PARTIAL UNIQUE INDEX
--
--    NULLs never collide in a btree unique index, so the index constrains
--    nothing when source_id is NULL. postJournalEntry maps an omitted optional
--    sourceId to NULL. Measured: two `orders`/`sales` entries with NULL
--    source_id in one org, both accepted.
--
--    Every current caller passes order.id (orderLedger.ts is the only producer
--    of source_table='orders' AND journal_type='sales'; returns.ts posts
--    journal_type='sales' with source_table='order_returns' and is untouched
--    by this constraint). So this closes the hole before something falls in,
--    rather than after.
--
-- Everything below is safe to re-apply, and every part ASSERTS its own result
-- rather than trusting that the statement above did what it reads as doing —
-- which is the actual lesson of defect 2.

-- `public` ONLY -- pg_catalog is deliberately NOT listed.
--
-- The first draft of this file (0051, never merged) wrote
-- `public, pg_catalog`, which is worse than writing nothing. pg_catalog is
-- searched implicitly BEFORE every user schema, but naming it explicitly moves
-- it to the position given -- so that draft demoted the system catalogue below
-- `public` and made every built-in shadowable by anything able to create there.
-- Measured, with a public.current_setting(text, boolean) planted:
--
--   search_path = public, pg_catalog   ->  SHADOWED
--   search_path = public               ->  correct value
--   pg_catalog.current_setting(...)    ->  correct value
--
-- The built-ins this file calls are pg_catalog-qualified as well, so the
-- result does not rest on search_path being right.
--
-- The POLICY bodies below deliberately call current_setting UNQUALIFIED, in
-- the same form as all 53 tenant policies 0031/0032/0048/0050 created. Only
-- pg_database_owner holds CREATE on public here (irth_app does not), and that
-- role has BYPASSRLS -- so RLS is not a boundary against the one principal who
-- could plant a shadowing overload. Qualifying 7 of 53 policy bodies would buy
-- nothing real and leave the set inconsistent; rewriting all 53 to chase it
-- would put live tenant isolation at risk for no gain.
--
-- SET LOCAL reverts on COMMIT and ROLLBACK, and the runner wraps each file in
-- one transaction.
SET LOCAL search_path TO public;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. Re-assert RLS on the seven tables, schema-qualified, then verify
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t        text;
  missing  text;
  tables   text[] := ARRAY[
    'inventory_discrepancies',
    'shopify_connections',
    'shopify_oauth_states',
    'shopify_webhook_deliveries',
    'storefront_sessions',
    'storefront_events',
    'storefront_daily_metrics'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'public.% is missing; 0045/0047 must be applied before 0051', t;
    END IF;

    -- %I.%I throughout: the table, and the policy's target.
    EXECUTE pg_catalog.format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', t);
    EXECUTE pg_catalog.format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', 'public', t);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON %I.%I', t || '_tenant_isolation', 'public', t);
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON %I.%I '
      'USING (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid) '
      'WITH CHECK (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid)',
      t || '_tenant_isolation', 'public', t
    );
    EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO irth_app', 'public', t);
  END LOOP;

  -- Verify, rather than assume the loop above did what it reads as doing.
  SELECT string_agg(pg_catalog.format('%s (rls=%s forced=%s policies=%s)',
                           c.relname, c.relrowsecurity, c.relforcerowsecurity,
                           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)),
                    E'\n  ')
    INTO missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = ANY (tables)
     AND (NOT c.relrowsecurity
          OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS was not applied to every table' USING DETAIL = E'\n  ' || missing;
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Pre-flight: rows that would make the constraints below impossible
-- ---------------------------------------------------------------------------
-- Neither branch deletes or edits anything. journal_lines carries no UPDATE or
-- DELETE grant and a wrong entry is corrected by a REVERSING entry, never by
-- removing history (CLAUDE.md rule 2). A migration that stops with the offending
-- rows named is the correct outcome; one that "cleans up" financial records
-- nobody has read is not.
DO $$
DECLARE
  nulls int;
  dupes text;
  n     int;
BEGIN
  SELECT count(*) INTO nulls
    FROM public.journal_entries
   WHERE source_table = 'orders' AND journal_type = 'sales' AND source_id IS NULL;

  IF nulls > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = pg_catalog.format('%s order sales entr(y/ies) have a NULL source_id; the CHECK below cannot be added.', nulls),
      HINT    = 'These entries cannot be tied back to an order. Reverse them (reverseJournalEntry in packages/db/src/ledger.ts) and re-post with sourceId set. Do not DELETE journal rows — CLAUDE.md rule 2.';
  END IF;

  SELECT count(*), string_agg(pg_catalog.format('org=%s order=%s (%s entries)', org_id, source_id, c), E'\n  ')
    INTO n, dupes
    FROM (
      SELECT org_id, source_id, count(*) AS c
        FROM public.journal_entries
       WHERE source_table = 'orders' AND journal_type = 'sales' AND source_id IS NOT NULL
       GROUP BY org_id, source_id
      HAVING count(*) > 1
    ) d;

  IF n > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = pg_catalog.format('%s order(s) carry more than one sales entry; the uniqueness index cannot be created.', n),
      DETAIL  = E'\n  ' || dupes,
      HINT    = 'Post a reversing entry for the surplus entries (reverseJournalEntry in packages/db/src/ledger.ts), then re-run. Do not DELETE journal rows — CLAUDE.md rule 2.';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Rebuild the uniqueness index from a known definition, then verify it
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than IF NOT EXIST'ed: that is the only form
-- whose result does not depend on what was already there under the name. The
-- whole file is one transaction holding ACCESS EXCLUSIVE, so the guarantee is
-- never absent to any other session.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'journal_entries_order_sale_once'
       AND conrelid = 'public.journal_entries'::regclass
  ) THEN
    RAISE EXCEPTION 'journal_entries_order_sale_once is a CONSTRAINT, not a plain index; drop it deliberately before re-running.';
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS public.journal_entries_order_sale_once;--> statement-breakpoint

CREATE UNIQUE INDEX journal_entries_order_sale_once
  ON public.journal_entries (org_id, source_id)
  WHERE source_table = 'orders' AND journal_type = 'sales';--> statement-breakpoint

DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT i.indisunique AND i.indisvalid
    INTO ok
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname = 'journal_entries_order_sale_once'
     AND c.relnamespace = 'public'::regnamespace;

  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'journal_entries_order_sale_once is missing, not unique, or not valid after creation.';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. An order sale must name the order it came from
-- ---------------------------------------------------------------------------
-- Without this the index above constrains nothing when source_id is NULL, and
-- an entry that cannot be traced to an order is unauditable regardless.
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_order_sale_needs_source;--> statement-breakpoint

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_order_sale_needs_source
  CHECK (source_table IS DISTINCT FROM 'orders'
         OR journal_type IS DISTINCT FROM 'sales'
         OR source_id IS NOT NULL);
