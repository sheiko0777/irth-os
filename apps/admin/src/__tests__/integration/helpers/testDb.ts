/**
 * A real Drizzle handle against the disposable test branch.
 *
 * Deliberately does NOT import `@irth/db`'s `db` singleton: that one reads
 * DATABASE_URL at module load, and the whole point here is to talk to the test
 * branch instead. The schema, however, is the real one — testing against a
 * hand-rolled copy would prove nothing about the tables deploy creates.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is not set — globalSetup should have loaded it.');
}

// prepare: false so the same handle works against a pooled endpoint.
export const client = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
export const testDb = drizzle(client);

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
  await client.end({ timeout: 5 });
}
