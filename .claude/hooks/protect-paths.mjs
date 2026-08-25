#!/usr/bin/env node
/**
 * PreToolUse guard for files that must not be edited in place.
 *
 * CLAUDE.md states these rules; nothing enforced them. Each one is here because
 * breaking it fails silently rather than loudly:
 *
 *   - pnpm-lock.yaml   A hand-edited lockfile diverges from what CI installs
 *                      with `--frozen-lockfile`, so it breaks on the build
 *                      machine and nowhere else.
 *   - applied .sql     packages/db/scripts/migrate.mjs keys its ledger on
 *                      FILENAME. An edited migration that already ran never
 *                      re-runs, so the schema and the SQL diverge permanently
 *                      and no error is ever raised. New files are fine — only
 *                      existing ones are protected.
 *   - .env*            Real credentials. apps/admin/.env.test.local holds a
 *                      live Neon connection string. .env.example is allowed.
 *
 * Exit 2 blocks the call and shows stderr to Claude. Any internal failure
 * exits 0: a broken guard must not become a broken repo.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOW_ENV = /(^|[\\/])\.env\.example$/i;

function decide(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const base = path.basename(p);

  if (base === 'pnpm-lock.yaml') {
    return 'pnpm-lock.yaml is generated. Change package.json and run an install; never hand-edit the lockfile (CI uses --frozen-lockfile).';
  }

  if (/(^|\/)\.env/.test(p) && !ALLOW_ENV.test(p)) {
    return `${base} holds real credentials and is gitignored. Edit it yourself, or use .env.example for anything shared.`;
  }

  // Only migrations that already exist — creating the next one is the normal path.
  if (/\/packages\/db\/drizzle\/[^/]+\.sql$/.test(p) && existsSync(filePath)) {
    return `${base} is an existing migration. migrate.mjs keys its ledger on filename, so an edit here never re-runs: the database keeps the old shape while the file claims the new one. Add a new numbered migration instead.`;
  }

  return null;
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
    if (typeof target !== 'string' || target.length === 0) process.exit(0);

    const reason = decide(target);
    if (reason) {
      process.stderr.write(`[protect-paths] Blocked: ${reason}\n`);
      process.exit(2);
    }
  } catch {
    // Malformed input, missing field, anything else — allow. This hook exists to
    // catch a known mistake, not to be a single point of failure.
  }
  process.exit(0);
});
