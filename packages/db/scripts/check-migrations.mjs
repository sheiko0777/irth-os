#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATION_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Pure planning function for migration verification.
 *
 * Enforces:
 *   1. All migration filenames must match /^\d{4}_[a-z0-9_]+\.sql$/
 *   2. Existing migrations on origin/main cannot be modified (M), deleted (D), or renamed (R)
 *   3. Added migrations must have a prefix strictly greater than max(main)
 *   4. Unique 4-digit prefixes across main + PR (no collisions)
 *
 * @param {string[]} mainFiles - List of existing SQL migration paths/filenames on main
 * @param {Array<{ status: string, file: string } | string>} prFilesWithStatus - List of git diff status items for PR
 * @returns {{ ok: boolean, errors: string[], maxMain: number }}
 */
export function plan(mainFiles, prFilesWithStatus) {
  const errors = [];
  const prefixes = new Map();

  let maxMain = -1;

  // 1. Process main migrations
  for (const raw of mainFiles) {
    const file = path.basename(raw.trim());
    if (!file.endsWith('.sql')) continue;

    const match = file.match(/^(\d{4})_/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxMain) {
        maxMain = num;
      }
      const prefix = match[1];
      if (!prefixes.has(prefix)) {
        prefixes.set(prefix, []);
      }
      prefixes.get(prefix).push(file);
    }
  }

  // Normalize PR diff items
  const prItems = (prFilesWithStatus || []).map((item) => {
    if (typeof item === 'string') {
      const parts = item.trim().split(/\s+/);
      const status = parts[0];
      const file = parts[parts.length - 1];
      return { status, file };
    }
    return item;
  });

  // 2. Inspect PR changes
  for (const item of prItems) {
    const filename = path.basename(item.file.trim());
    if (!filename.endsWith('.sql')) continue;

    const statusCode = item.status ? item.status.charAt(0).toUpperCase() : '';

    // Disallow editing, deleting, or renaming existing migrations
    if (statusCode === 'M') {
      errors.push(`Cannot modify existing migration file: ${filename}`);
      continue;
    }
    if (statusCode === 'D') {
      errors.push(`Cannot delete existing migration file: ${filename}`);
      continue;
    }
    if (statusCode === 'R') {
      errors.push(`Cannot rename existing migration file: ${filename}`);
      continue;
    }

    // Process added migrations
    if (statusCode === 'A') {
      if (!MIGRATION_PATTERN.test(filename)) {
        errors.push(
          `Migration filename "${filename}" is malformed. Must match pattern /^\\d{4}_[a-z0-9_]+\\.sql$/`,
        );
        continue;
      }

      const match = filename.match(/^(\d{4})_/);
      if (match) {
        const prefix = match[1];
        const num = parseInt(prefix, 10);

        if (maxMain >= 0 && num <= maxMain) {
          const maxStr = String(maxMain).padStart(4, '0');
          errors.push(
            `Migration number ${prefix} (${filename}) must be strictly greater than origin/main's highest migration (${maxStr}).`,
          );
        }

        if (!prefixes.has(prefix)) {
          prefixes.set(prefix, []);
        }
        prefixes.get(prefix).push(filename);
      }
    }
  }

  // 3. Check for duplicates across main + PR
  for (const [prefix, files] of prefixes.entries()) {
    if (files.length > 1) {
      errors.push(
        `Duplicate migration number "${prefix}": found in ${files.join(', ')}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    maxMain,
  };
}

function resolveBaseRef() {
  try {
    execSync('git rev-parse --verify origin/main', { stdio: 'ignore' });
    return 'origin/main';
  } catch {
    try {
      execSync('git rev-parse --verify main', { stdio: 'ignore' });
      return 'main';
    } catch {
      return 'HEAD';
    }
  }
}

function getMigrationsFromRef(ref) {
  try {
    const stdout = execSync(`git ls-tree -r --name-only ${ref} -- packages/db/drizzle`, {
      encoding: 'utf8',
    });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.sql'));
  } catch {
    return [];
  }
}

function getDiffFromRef(ref) {
  try {
    const items = new Map();

    // 1. Committed changes between ref and HEAD (PR changes)
    const prDiff = execSync(`git diff --name-status ${ref}...HEAD -- packages/db/drizzle`, {
      encoding: 'utf8',
    });

    // 2. Uncommitted changes against HEAD (for local pre-commit verification)
    const localDiff = execSync(`git diff --name-status HEAD -- packages/db/drizzle`, {
      encoding: 'utf8',
    });

    // 3. Untracked files under drizzle (newly created files not yet staged)
    const untracked = execSync(`git ls-files --others --exclude-standard -- packages/db/drizzle`, {
      encoding: 'utf8',
    });

    const parseLines = (text) => {
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((line) => {
          const parts = line.split(/\s+/);
          const status = parts[0];
          const file = parts[parts.length - 1];
          if (file.endsWith('.sql')) {
            items.set(file, { status, file });
          }
        });
    };

    parseLines(prDiff);
    parseLines(localDiff);

    untracked
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.sql'))
      .forEach((file) => {
        if (!items.has(file)) {
          items.set(file, { status: 'A', file });
        }
      });

    return Array.from(items.values());
  } catch {
    return [];
  }
}

export function runCli() {
  const baseRef = resolveBaseRef();
  const mainFiles = getMigrationsFromRef(baseRef);
  const prFiles = getDiffFromRef(baseRef);
  const result = plan(mainFiles, prFiles);

  if (!result.ok) {
    console.error(`migration-check FAILED against ${baseRef}:`);
    for (const err of result.errors) {
      console.error(`  ✖ ${err}`);
    }
    process.exit(1);
  }

  console.log(
    `migration-check PASSED against ${baseRef} (${mainFiles.length} main migrations, ${prFiles.length} PR migrations).`,
  );
  process.exit(0);
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runCli();
}
