#!/usr/bin/env node
/**
 * PostToolUse early warning: a decimal/numeric MONEY column just entered the
 * schema (CLAUDE.md rule 1 — money is bigint minor units).
 *
 * The authoritative gate is packages/db/src/__tests__/moneyColumns.test.ts, and
 * this does NOT replace it. The test runs in CI and is a ratchet with an
 * explicit allowlist; this only tells the author immediately, while they still
 * have the context, instead of ten minutes later on a PR.
 *
 * The check is reimplemented inline rather than shelling out to vitest on
 * purpose: hooks run on every edit and must stay in the low milliseconds. A
 * vitest spawn is ~2s and would make editing the schema feel broken.
 */
import { readFileSync } from 'node:fs';

// Fractional by nature: physical quantities and rates. Rates belong in basis
// points, but they are not money, so they are out of scope for this warning.
const NOT_MONEY = /weight|percent|ratio|rate$|_rate|qty|quantity|score|length|width|height/i;
const IS_MONEY =
  /price|amount|cost|balance|total|revenue|spent|refund|fee|subtotal|value|credit|debit|paid|due|salary|discount/i;

function offenders(source) {
  // Offsets, not lines: schema/coupons.ts puts the table name on the line AFTER
  // pgTable(, and a line-scoped regex silently misses it.
  const tables = [...source.matchAll(/pgTable\(\s*['"]([a-z0-9_]+)['"]/gi)].map((m) => ({
    name: m[1],
    at: m.index ?? 0,
  }));

  return [...source.matchAll(/\b(numeric|decimal)\s*\(\s*['"]([a-z0-9_]+)['"]/gi)]
    .map((m) => {
      const at = m.index ?? 0;
      const owner = [...tables].reverse().find((t) => t.at < at);
      return { table: owner?.name ?? '<none>', column: m[2] };
    })
    .filter((c) => IS_MONEY.test(c.column) && !NOT_MONEY.test(c.column));
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const target = input?.tool_input?.file_path;
    if (typeof target !== 'string') process.exit(0);

    const p = target.replace(/\\/g, '/');
    if (!/\/packages\/db\/src\/schema/.test(p)) process.exit(0);

    const found = offenders(readFileSync(target, 'utf8'));
    if (found.length > 0) {
      const list = found.map((f) => `  ${f.table}.${f.column}`).join('\n');
      process.stderr.write(
        `[money-gate] decimal/numeric money column(s) in ${p}:\n${list}\n` +
          `Money is bigint minor units (piastres) — see CLAUDE.md rule 1 and @irth/domain.\n` +
          `packages/db test 'rule 1 — money is bigint minor units' will fail on this.\n`,
      );
      process.exit(2);
    }
  } catch {
    // Unreadable file, malformed input — stay quiet. Advisory only.
  }
  process.exit(0);
});
