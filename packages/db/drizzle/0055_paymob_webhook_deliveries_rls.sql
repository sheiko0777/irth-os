-- 0055: RLS for paymob_webhook_deliveries (0054 created it without it).
--
-- WHY THIS EXISTS
--
-- 0054_paymob_webhook_deliveries.sql creates a table carrying
-- `org_id uuid NOT NULL REFERENCES organizations(id)` (plus the full raw
-- Paymob webhook payload in `payload`, including card metadata under
-- `source_data`) and never enables row-level security or creates a policy.
--
-- This is the identical defect 0049/0050/0052 already closed for seven other
-- tables (inventory_discrepancies, shopify_connections, shopify_oauth_states,
-- shopify_webhook_deliveries, storefront_sessions, storefront_events,
-- storefront_daily_metrics) — a table added without going through the
-- catalogue loop that seeded RLS on the original tenant tables. The
-- rlsCoverage integration test those migrations introduced is what turned
-- this from invisible into a red build here too; the table is fixed instead
-- of relaxing the gate.
--
-- WHY THIS IS SAFE
--
-- Traced before writing, not assumed. The only current reader/writer is
-- apps/api/src/routes/webhooks/paymob.ts, which uses the bare `db` export
-- (apps/api/src/db.ts) — the `neondb_owner` role, which has rolbypassrls and
-- is unaffected by RLS regardless (same as every apps/api webhook route
-- 0050's header already traced). So this migration changes no existing
-- behaviour. What it closes is the structural gap: a future read of this
-- table through the org-scoped `irth_app` role (e.g. an admin UI listing
-- payment webhook history via ctx.withOrg) is refused across tenants by the
-- database instead of depending on every future caller remembering to filter
-- by org_id itself.
--
-- Every statement is written to be safe to re-apply — the migration ledger in
-- scripts/migrate.mjs is keyed by filename, and the integration job shares
-- one long-lived Neon branch across PRs, so a renumbering must not be able to
-- abort a build (same note as 0049/0050).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'paymob_webhook_deliveries' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'public.paymob_webhook_deliveries is missing; 0054 must be applied before 0055';
  END IF;

  EXECUTE 'ALTER TABLE paymob_webhook_deliveries ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE paymob_webhook_deliveries FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS paymob_webhook_deliveries_tenant_isolation ON paymob_webhook_deliveries';

  -- NULLIF, matching 0031/0032/0048/0050 — current_setting(name, true)
  -- returns '' rather than NULL once anything has set that GUC on the
  -- backend, and ''::uuid raises 22P02 on every query against the table.
  -- USING gates reads and the pre-image of a write; WITH CHECK gates the
  -- post-image, so a row cannot be inserted into, or moved into, another
  -- tenant.
  EXECUTE
    'CREATE POLICY paymob_webhook_deliveries_tenant_isolation ON paymob_webhook_deliveries ' ||
    'USING (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid) ' ||
    'WITH CHECK (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid)';

  -- 0031's ALTER DEFAULT PRIVILEGES already grants these to irth_app for
  -- tables created by the same role afterwards, which covers 0054. Stated
  -- explicitly anyway, as 0036/0037/0038/0049/0050 do: a table that is
  -- RLS-forced and ungranted is unreachable by the application, and the
  -- failure mode is a permission error in production rather than anything CI
  -- would show.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON paymob_webhook_deliveries TO irth_app';
END $$;
