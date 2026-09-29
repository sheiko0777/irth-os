/**
 * CLAUDE.md rule 2: reports read the ledger. They do not SUM(orders.total_amount_minor).
 *
 * Every revenue figure in the dashboard, analytics, finance AI answer, VAT
 * report and the API's AI sales tool was once exactly that sum — gross,
 * VAT-inclusive, blind to refunds, and on one card labelled "profit". They now
 * go through @irth/db's salesTotals/dailyNetSales. This gate fails the build
 * the moment a sum over order totals reappears anywhere in server code, so the
 * next report cannot quietly go back to it.
 *
 * Comments are stripped before matching: explaining what was replaced is fine.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCANNED_ROOTS = [
  path.resolve(HERE, '../server'),
  path.resolve(HERE, '../../../api/src'),
];

/** Drizzle `sum(orders.totalAmountMinor)` and raw `SUM(total_amount_minor)` / `SUM(o.total_amount_minor)`. */
const ORDER_TOTAL_SUMS = [
  /\bsum\s*\(\s*orders\s*\.\s*totalAmountMinor\s*\)/g,
  /\bSUM\s*\(\s*(?:\w+\s*\.\s*)?total_amount_minor\s*\)/gi,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('revenue source gate', () => {
  it('no server code sums order totals — revenue comes from the ledger', () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of sourceFiles(root)) {
        const code = withoutComments(readFileSync(file, 'utf8'));
        for (const pattern of ORDER_TOTAL_SUMS) {
          for (const match of code.matchAll(pattern)) {
            const line = code.slice(0, match.index).split('\n').length;
            offenders.push(`${path.relative(path.resolve(HERE, '../../..'), file)}:${line} ${match[0]}`);
          }
        }
      }
    }
    expect(
      offenders,
      'Revenue must come from the ledger (salesTotals / dailyNetSales in @irth/db), not a sum over orders. Offenders:\n'
        + offenders.join('\n'),
    ).toEqual([]);
  });
});
