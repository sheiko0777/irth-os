/**
 * A real Drizzle handle against the disposable test branch.
 *
 * Deliberately does NOT import `@irth/db`'s `db` singleton: that one reads
 * DATABASE_URL at module load, and the whole point here is to talk to the test
 * branch instead. The schema, however, is the real one — testing against a
 * hand-rolled copy would prove nothing about the tables deploy creates.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@irth/db';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is not set — globalSetup should have loaded it.');
}

// Built with the app's own factory rather than a bare drizzle() call, so this
// handle is the same *type* as the one production uses. Helpers that take a
// DbInstance — withOrgContext in particular — then accept it without a cast,
// and a test cannot accidentally exercise a differently-shaped client.
export const testDb = createDb(url);

/**
 * Empties every application table, leaving the schema and the migration ledger
 * intact. CASCADE plus a single statement means insertion order and foreign
 * keys do not have to be reasoned about.
 */
export async function truncateAll(): Promise<void> {
  const rows = await testDb.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_migrations', '_integration_marker')
  `);

  const names = [...rows].map((r) => `"public"."${r.tablename}"`);
  if (names.length === 0) return;

  await testDb.execute(sql.raw(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`));
}

/** Closes the pool so vitest can exit instead of hanging on an open socket. */
export async function closeTestDb(): Promise<void> {
  await testDb.$client.end({ timeout: 5 });
}
