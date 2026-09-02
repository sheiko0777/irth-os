#!/usr/bin/env node
/**
 * Applies every SQL file in drizzle/ in filename order, exactly once.
 *
 * WHY NOT drizzle-orm's own migrator
 *
 * It reads drizzle/meta/_journal.json, which has 5 entries against 24 SQL
 * files: everything from 0006 onward was hand-written rather than produced by
 * `drizzle-kit generate`, so it never got a journal entry. Running the official
 * migrator here would apply the first five migrations, report success, and
 * silently skip the other nineteen — worse than having no migrate script at
 * all, which is what this package had.
 *
 * This runner keeps its own ledger keyed by filename, so it does not care how a
 * migration was authored. `drizzle-kit generate` keeps working for schema
 * diffs; this just applies whatever SQL ends up in the folder.
 *
 * Guarantees:
 *   - ordered by filename
 *   - each file runs inside one transaction, so a failure halfway leaves that
 *     migration fully rolled back rather than half-applied
 *   - stops at the first failure with a non-zero exit, so a broken deploy stops
 *     instead of continuing over a wrecked schema
 *   - already-applied files are skipped, so it is safe to re-run
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// max: 1 keeps every statement on one connection; DDL and the ledger write must
// not land on different backends.
//
// prepare: false because DATABASE_URL may point at a pooled endpoint (Neon's
// `-pooler` host is PgBouncer in transaction mode, which does not support
// prepared statements). postgres-js prepares by default, so without this the
// runner works against a direct endpoint and fails against a pooled one — a
// difference nobody notices until a deploy uses the other URL.
//
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// Every migration in drizzle/ writes unqualified names, and several build DDL
// dynamically with format('ALTER TABLE %I', …). The schema those resolve to is
// whatever the connecting role's default search_path happens to be, so a
// migration can verify a table in `public` and then alter a same-named table in
// another schema — and report success. Measured on 0050: with a `shadow` schema
// ahead of `public`, RLS landed on shadow.shopify_connections and left
// public.shopify_connections exposed.
//
// Pinned as a SET LOCAL inside each migration's own transaction, NOT as a
// startup parameter: the note above says this URL may be Neon's `-pooler` host,
// which is PgBouncer in transaction mode, and PgBouncer rejects startup
// parameters outside the small set it tracks — `search_path` is not one of
// them, so a startup parameter would fail to connect against exactly the
// endpoint that comment is warning about.
//
// SET LOCAL is also the form CLAUDE.md rule 3 requires of every GUC here: it
// reverts on COMMIT and on ROLLBACK, so it cannot leak to whatever uses this
// pooled connection next.
const SCOPE_SEARCH_PATH = 'SET LOCAL search_path TO public, pg_catalog';

async function main() {
  // Written schema-qualified rather than relying on search_path: these two run
  // outside any transaction, so the SET LOCAL above cannot cover them, and the
  // ledger deciding which migrations are pending is the last thing that should
  // resolve to a schema nobody chose.
  await sql`
    CREATE TABLE IF NOT EXISTS public._migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT filename FROM public._migrations`).map((r) => r.filename),
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`up to date (${files.length} migrations)`);
    return;
  }

  console.log(`applying ${pending.length} of ${files.length} migrations`);

  for (const file of pending) {
    const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // drizzle-kit's separator. Files without it run as a single statement.
    const statements = body
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(SCOPE_SEARCH_PATH);
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx`INSERT INTO public._migrations (filename) VALUES (${file})`;
      });
      console.log(`  applied  ${file}`);
    } catch (err) {
      console.error(`  FAILED   ${file}`);
      console.error(`  ${err.message}`);
      throw err;
    }
  }

  console.log(`done — ${pending.length} applied`);
}

try {
  await main();
} catch {
  // The failing migration already printed its own message.
  await sql.end({ timeout: 5 });
  process.exit(1);
}
await sql.end({ timeout: 5 });
