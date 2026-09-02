-- 0050: RLS for the six org-scoped tables 0047 created without it.
--
-- WHY THIS EXISTS
--
-- 0047_shopify_connections_and_analytics.sql (merged from main) creates six
-- tables that each carry `org_id uuid NOT NULL REFERENCES organizations(id)`
-- and none of them enables row-level security or creates a policy:
--
--   shopify_connections          holds the encrypted Shopify access token
--   shopify_oauth_states         holds in-flight OAuth state hashes
--   shopify_webhook_deliveries   raw webhook bodies
--   storefront_sessions          per-visitor storefront sessions
--   storefront_events            storefront event stream
--   storefront_daily_metrics     rolled-up storefront metrics
--
-- This is the identical defect 0049 closes for inventory_discrepancies, and it
-- has the identical cause: RLS is NOT inherited. 0031's catalogue loop ran
-- once, over the tables that existed then — 0037 hit this trap, 0045 hit it,
-- and 0047 hit it again. Every one of these tables is CLAUDE.md rule 3's
-- second layer missing, and two of them are credential stores.
--
-- The rlsCoverage integration test added alongside 0049 is what turned this
-- from invisible into a red build. It is deliberately NOT relaxed to
-- accommodate these tables; the tables are fixed instead.
--
-- WHY AN EXPLICIT LIST AND NOT ANOTHER CATALOGUE LOOP
--
-- Because a catalogue loop is what produced this bug three times. A loop runs
-- once, at the moment its migration is applied, and then reads as though it
-- covers everything forever. Naming the six tables makes the scope of this
-- migration exactly what a reviewer can see, and the coverage gate — which
-- runs on every CI build rather than once — is the thing that catches the
-- seventh table.
--
-- WHY THIS IS SAFE FOR THE SHOPIFY INTEGRATION
--
-- Traced before writing, not assumed. Policies only bite inside
-- withOrgContext, which is the only thing that drops the session into the
-- `irth_app` role; outside it the connection is `neondb_owner`, which has
-- rolbypassrls and is therefore unaffected even by FORCE (measured in 0031's
-- header). Every access path was checked:
--
--   apps/api/src/routes/webhooks/shopify.ts   bare `db` (owner)  -> unaffected
--   apps/api/src/routes/shopifyPixel.ts       bare `db` (owner)  -> unaffected
--   apps/api/src/workers/storefrontRollup.ts  bare `db` (owner)  -> unaffected
--   apps/api/src/routes/shopify.ts /callback  the state lookup is deliberately
--     outside org context (the callback has no org until that row resolves it)
--     and runs as owner; the withOrgContext block that follows is scoped to
--     oauthState.orgId and writes rows whose org_id is that same value, so
--     both USING and WITH CHECK match.
--   apps/admin/.../routers/integrations.ts    reads via ctx.db (owner);
--     the one ctx.withOrg write inserts orgId: ctx.orgId -> WITH CHECK matches.
--
-- So no existing path changes behaviour. What changes is that a future query
-- which forgets its org_id filter is refused by the database instead of
-- returning another tenant's Shopify token.
--
-- Every statement is written to be safe to re-apply: the migration ledger in
-- scripts/migrate.mjs is keyed by filename, and the integration job shares one
-- long-lived Neon branch across PRs, so a renumbering must not be able to
-- abort a build (see the same note in 0049).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shopify_connections',
    'shopify_oauth_states',
    'shopify_webhook_deliveries',
    'storefront_sessions',
    'storefront_events',
    'storefront_daily_metrics'
  ]
  LOOP
    -- Guard rather than assume the table is present: this migration sits in a
    -- branch that merged 0047 from main, and a bare ALTER on a missing table
    -- would abort the whole file for anyone whose database predates it.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'table %.% is missing; 0047 must be applied before 0050', 'public', t;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);

    -- NULLIF, matching 0032 and 0048 — NOT 0031's original form.
    -- current_setting(name, true) returns '' rather than NULL once anything has
    -- set that GUC on the backend, and ''::uuid raises 22P02 on every query
    -- against the table. USING gates reads and the pre-image of a write;
    -- WITH CHECK gates the post-image, so a row cannot be inserted into, or
    -- moved into, another tenant.
    EXECUTE format(
      'CREATE POLICY %I ON %I '
      'USING (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid) '
      'WITH CHECK (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid)',
      t || '_tenant_isolation', t
    );

    -- 0031's ALTER DEFAULT PRIVILEGES already grants these to irth_app for
    -- tables created by the same role afterwards, which covers 0047. Stated
    -- explicitly anyway, as 0036/0037/0038/0049 do: a table that is RLS-forced
    -- and ungranted is unreachable by the application, and the failure mode is
    -- a permission error in production rather than anything CI would show.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO irth_app', t);
  END LOOP;
END $$;
