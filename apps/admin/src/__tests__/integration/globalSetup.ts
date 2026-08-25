/**
 * Runs once before the integration suite: proves we are pointed at a disposable
 * database, then migrates it.
 *
 * These tests exist because the unit suite mocks `db` wholesale
 * (`src/__tests__/helpers/mockDb.ts`), so it cannot exercise a NOT NULL, a
 * foreign key, a trigger, or an RLS policy — every rule in CLAUDE.md that the
 * database is supposed to enforce is invisible to it. A green mock-only suite
 * proves the code calls Drizzle, not that the data is correct.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { config as loadEnv } from 'dotenv';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(HERE, '../../..');
const DB_PACKAGE = path.resolve(ADMIN_ROOT, '../../packages/db');

/** Written to the test database so we can recognise it later. */
const MARKER_TABLE = '_integration_marker';

export async function setup() {
  loadEnv({ path: path.join(ADMIN_ROOT, '.env.test.local') });

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set.\n' +
        'Integration tests need a real, disposable Postgres branch.\n' +
        'Local: create apps/admin/.env.test.local with TEST_DATABASE_URL=…\n' +
        'CI:    set the TEST_DATABASE_URL secret.',
    );
  }

  // A deliberately separate variable from DATABASE_URL, and refused if they
  // match: this harness truncates tables, and doing that to the app database
  // because two env vars happened to hold the same string is not a mistake
  // worth leaving available.
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run — ' +
        'the integration suite truncates every table it touches.',
    );
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    // Second guard: if this database already holds application data but carries
    // no marker, it is not ours. Only a database we have already claimed, or an
    // empty one, may be used.
    const [{ exists: hasMarker }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${MARKER_TABLE}
      ) AS exists
    `;

    if (!hasMarker) {
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name NOT IN ('_migrations', ${MARKER_TABLE})
      `;
      if (count > 0) {
        throw new Error(
          `Refusing to use this database: it has ${count} application table(s) in ` +
            `public but no ${MARKER_TABLE}. Point TEST_DATABASE_URL at a ` +
            'disposable branch, not a database with real data.',
        );
      }
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (claimed_at timestamptz NOT NULL DEFAULT now())`,
      );
      await sql.unsafe(`INSERT INTO ${MARKER_TABLE} DEFAULT VALUES`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Reuse the real migration runner rather than a test-only reimplementation —
  // otherwise the suite validates a schema that deploy never produces. It is
  // idempotent, so re-running across suite invocations is free.
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(DB_PACKAGE, 'scripts', 'migrate.mjs')],
    { env: { ...process.env, DATABASE_URL: url }, cwd: DB_PACKAGE },
  );
  // eslint-disable-next-line no-console
  console.log(`[integration] ${stdout.trim().split('\n').pop()}`);
}
