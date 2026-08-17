-- Harden every tenant policy against an empty `app.org_id`.
--
-- 0031 wrote the predicate as:
--     org_id = (SELECT current_setting('app.org_id', true))::uuid
--
-- `current_setting(name, true)` returns NULL only while the setting has NEVER
-- been touched on that backend. Once anything sets it — including a
-- `set_config(..., false)` from a stray script, or a previous request on the
-- same pooled connection — it becomes the EMPTY STRING rather than NULL, and
-- `''::uuid` raises:
--
--     invalid input syntax for type uuid: ""
--
-- Observed directly on the test branch: after one session-level set_config, all
-- subsequent queries against every policy-protected table failed with that
-- error. That is not a leak, it is a hard outage on a shared connection, and it
-- would be extremely confusing to diagnose — the same query works on one
-- connection and fails on another depending on what ran there earlier.
--
-- NULLIF collapses both cases to NULL. `org_id = NULL` is NULL, which is not
-- true, so the row is filtered out: an unset tenant now yields ZERO rows rather
-- than an exception, and never yields another tenant's rows.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'org_id'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t.table_name || '_tenant_isolation', t.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid) WITH CHECK (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid)',
      t.table_name || '_tenant_isolation', t.table_name
    );
  END LOOP;
END $$;--> statement-breakpoint

DROP POLICY IF EXISTS "organizations_tenant_isolation" ON "organizations";--> statement-breakpoint
CREATE POLICY "organizations_tenant_isolation" ON "organizations"
  USING (id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);
