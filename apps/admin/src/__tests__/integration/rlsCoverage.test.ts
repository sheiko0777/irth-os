/**
 * Asserts that EVERY tenant table has row-level security actually switched on,
 * forced, and carrying a policy — read from the catalogue, not from a list
 * somebody has to remember to update.
 *
 * WHY THIS EXISTS
 *
 * `tenantIsolation.test.ts` proves RLS works on the tables it exercises. It
 * cannot prove RLS EXISTS on a table nobody wrote a test for, and that is the
 * gap that actually bit: 0031 enabled RLS with a catalogue loop that ran once,
 * over the tables that existed at the time. RLS is not inherited, so every
 * table added afterwards had to remember to opt in. 0037 hit this and said so
 * in its own comment. 0045 (`inventory_discrepancies`) then did it again —
 * `org_id uuid NOT NULL`, two org-scoped indexes, no ENABLE, no POLICY — and
 * nothing anywhere noticed, because `grep -rn "relrowsecurity\|pg_policy"` over
 * this repository returned zero hits before this file.
 *
 * Three occurrences was not the end of it. While this file was in review, 0047
 * landed on main and did it a FOURTH time, to six tables at once —
 * shopify_connections, shopify_oauth_states, shopify_webhook_deliveries,
 * storefront_sessions, storefront_events, storefront_daily_metrics — two of
 * them holding credentials. This gate is what turned that from invisible into
 * a red build, and 0050 is the fix it forced. That is the argument for the
 * gate existing, written down at the moment it paid for itself: the mistake is
 * not one careless migration, it is a trap the schema sets for every migration,
 * and the only durable answer is a check that runs every time rather than a
 * loop that ran once.
 *
 * The membership rule is taken from 0031's own loop so the gate and the
 * migration cannot disagree about what a tenant table is: a base table in
 * `public` with an `org_id` column.
 *
 * Deriving the list from information_schema rather than hardcoding it is the
 * entire point. A hardcoded list would have to be updated by the same person
 * who forgot the ENABLE.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeTestDb, testDb } from './helpers/testDb';

/**
 * Tables that are correctly exempt.
 *
 * The four Better Auth tables are owned by Better Auth's own adapter and hold
 * identity, not tenant data — 0031 excludes them deliberately and says so.
 * `_migrations` is the custom runner's ledger (packages/db/scripts/migrate.mjs)
 * and `_integration_marker` is this suite's own branch claim; neither has an
 * org_id, so neither would be selected anyway. They are named here so that the
 * exemption is a decision on the record rather than an accident of the query.
 */
const EXEMPT = new Set(['user', 'session', 'account', 'verification', '_migrations', '_integration_marker']);

afterAll(async () => {
  await closeTestDb();
});

describe('RLS coverage', () => {
  it('every table with an org_id has RLS enabled, forced, and a policy', async () => {
    const rows = await testDb.execute<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policy_count: number;
    }>(sql`
      SELECT c.relname                          AS table_name,
             c.relrowsecurity                   AS rls_enabled,
             c.relforcerowsecurity              AS rls_forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        -- 'r' ordinary tables, 'p' partitioned parents. 0031's own loop
        -- filters on 'r' alone, so a partitioned tenant table would be
        -- skipped by the migration AND invisible here — and catching what
        -- that loop misses is this gate's entire reason to exist. There are
        -- no partitioned tables today, so this is preventative.
        --
        -- Partitions themselves are relkind 'r' with relispartition = true
        -- and are therefore already included. Postgres applies the parent's
        -- policies when a partitioned table is queried through the parent,
        -- but a partition queried DIRECTLY uses its own; requiring RLS on
        -- both is the strict reading, and the one that fails safe.
        AND c.relkind IN ('r', 'p')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'org_id'
        )
      ORDER BY c.relname
    `);

    const tenantTables = [...rows].filter((r) => !EXEMPT.has(r.table_name));

    // Guard against the query silently matching nothing — the same failure
    // mode schemaDrift.test.ts protects against with its own `> 50` floor. A
    // gate that passes because it selected zero rows is not a gate.
    expect(tenantTables.length).toBeGreaterThan(30);

    const unprotected = tenantTables
      .filter((r) => !r.rls_enabled || !r.rls_forced || r.policy_count < 1)
      .map((r) => `${r.table_name} (enabled=${r.rls_enabled}, forced=${r.rls_forced}, policies=${r.policy_count})`);

    expect(unprotected, `tenant tables missing RLS:\n  ${unprotected.join('\n  ')}`).toEqual([]);
  });
});
