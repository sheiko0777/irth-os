-- 0065: RLS on outbox_dead_letters.
--
-- 0064 created this table without RLS -- an oversight caught by
-- rlsCoverage.test.ts, this repo's own gate for exactly this mistake (see
-- that test's docstring: 0045 and 0047 both skipped RLS on a new org_id
-- table before the gate existed to catch it). Every table with an org_id
-- gets RLS; outbox_events itself has it, swept up by 0031's one-time
-- catalogue loop over the tables that existed when it ran -- RLS is not
-- inherited, so a table created afterward has to opt in explicitly, which
-- this one now does.
--
-- Fixed here rather than by editing 0064 in place: that file was already
-- applied (without RLS) against the shared integration-test database
-- before the gap was caught, and migrate.mjs's ledger is keyed by
-- filename, not content -- an edit to an already-applied file silently
-- never re-runs there. A follow-up migration is the only way that is both
-- correct on a fresh database and effective on one that already ran 0064.
--
-- Idempotent by construction: ENABLE/FORCE ROW LEVEL SECURITY are no-ops
-- if already set, and DROP POLICY IF EXISTS before CREATE POLICY matches
-- 0031's own pattern -- safe to run whether or not 0064 already left this
-- table RLS-less.
--
-- Does not change how the worker itself queries this table: processOutbox
-- connects as the owning (BYPASSRLS) role, same as every other outbox
-- table, never through a tenant-scoped `SET LOCAL ROLE irth_app` session.
-- FORCE matters as a safety net against a future caller that does.
ALTER TABLE "outbox_dead_letters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox_dead_letters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "outbox_dead_letters_tenant_isolation" ON "outbox_dead_letters";
--> statement-breakpoint
CREATE POLICY "outbox_dead_letters_tenant_isolation" ON "outbox_dead_letters"
  USING (org_id = (SELECT current_setting('app.org_id', true))::uuid)
  WITH CHECK (org_id = (SELECT current_setting('app.org_id', true))::uuid);
