/**
 * Fails the build if any tRPC router writes outside a tenant-scoped
 * transaction.
 *
 * This exists because a hand-run `grep "ctx\.db\.(insert|update|delete)"`
 * reported zero remaining write sites when there were thirty. Drizzle chains
 * read naturally as
 *
 *     const [row] = await ctx.db
 *       .update(orders)
 *
 * and a line-oriented pattern never sees `ctx.db.update(` because it does not
 * occur on any line. A check that can be defeated by a line break is not a
 * check, and "I grepped and it was clean" is exactly how the gap survived.
 *
 * Every write must go through `ctx.withOrg`, which drops to the unprivileged
 * `irth_app` role for the duration of a transaction. The pooled connection
 * authenticates as `neondb_owner`, which holds BYPASSRLS and owns every table,
 * so RLS policies are INERT for it. A write outside `withOrg` is a write the
 * database will not check — the policies exist, and simply do not apply.
 *
 * The escape hatch is `ctx.dbUnscoped`, allowed only in platformAdmin.ts (see
 * its comment in server/trpc.ts). Naming it keeps "bypasses tenant isolation"
 * greppable instead of inferred from the absence of a wrapper.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTERS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/routers');

/** Files permitted to use the unscoped connection, with the reason. */
const CROSS_ORG_BY_DESIGN = new Set(['platformAdmin.ts']);

/**
 * Whitespace-tolerant on purpose: `\s*` spans the newlines that hid these
 * sites from a line-based search.
 */
const UNSCOPED_WRITE = /(^|[^.\w])(ctx\s*\.\s*)?db\s*\.\s*(insert|update|delete)\s*\(/g;

/** `withAudit(ctx.db, …)` — the audit row lands outside the transaction. */
const UNSCOPED_AUDIT = /withAudit\s*\(\s*(ctx\s*\.\s*)?db\s*,/g;

function routerFiles(): string[] {
  return readdirSync(ROUTERS).filter((f) => f.endsWith('.ts'));
}

/** Reports "file:line" for each match so a failure names the site, not just the file. */
function findAll(source: string, file: string, re: RegExp): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(re)) {
    const line = source.slice(0, m.index).split('\n').length;
    hits.push(`${file}:${line}`);
  }
  return hits;
}

describe('tenancy gate', () => {
  it('has routers to scan (guards against the glob silently matching nothing)', () => {
    // A scanner over an empty file list passes every assertion below without
    // reading a byte — the failure mode that makes a green gate meaningless.
    expect(routerFiles().length).toBeGreaterThan(15);
  });

  it('routes every router write through ctx.withOrg', () => {
    const offenders: string[] = [];

    for (const file of routerFiles()) {
      if (CROSS_ORG_BY_DESIGN.has(file)) continue;
      const source = readFileSync(path.join(ROUTERS, file), 'utf8');
      offenders.push(...findAll(source, file, UNSCOPED_WRITE));
    }

    expect(
      offenders,
      `These writes bypass RLS — the connecting role has BYPASSRLS, so the ` +
        `policies do not apply to them. Wrap in ctx.withOrg(async (tx) => …) ` +
        `and write through tx:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('never hands withAudit a non-transaction', () => {
    const offenders: string[] = [];

    for (const file of routerFiles()) {
      const source = readFileSync(path.join(ROUTERS, file), 'utf8');
      offenders.push(...findAll(source, file, UNSCOPED_AUDIT));
    }

    expect(
      offenders,
      `withAudit given a non-transaction: the business write and its audit ` +
        `row commit separately, so a failure between them leaves a change with ` +
        `no record that it happened:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('confines the unscoped connection to platformAdmin', () => {
    const leaked: string[] = [];

    for (const file of routerFiles()) {
      if (CROSS_ORG_BY_DESIGN.has(file)) continue;
      const source = readFileSync(path.join(ROUTERS, file), 'utf8');
      if (source.includes('dbUnscoped')) leaked.push(file);
    }

    expect(
      leaked,
      `ctx.dbUnscoped reaches across every tenant. Only platform administration ` +
        `may use it; a caller's own data is reachable through ctx.withOrg:\n  ${leaked.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * Every tenant-table UPDATE/DELETE must name orgId in its own WHERE.
   *
   * Added because a real cross-tenant write got past the checks above.
   * `purchasing.po.receive` ended with
   *
   *     .where(eq(purchaseOrders.id, po.id))
   *
   * and nothing else. It ran inside ctx.withOrg, so every assertion in this
   * file passed and RLS would have refused the write at runtime — but that is
   * the backstop working, not the query being right. Defence in depth means
   * both layers hold; a query that relies on RLS alone is one `SET LOCAL ROLE`
   * regression away from being a cross-tenant write, and the procedure had no
   * other reason to be correct.
   *
   * INSERTs are excluded: they carry orgId in values(), not in a WHERE, and
   * the WITH CHECK half of each policy already gates the post-image.
   */
  it('scopes every UPDATE and DELETE by orgId, not just by id', () => {
    const offenders: string[] = [];

    for (const file of routerFiles()) {
      if (CROSS_ORG_BY_DESIGN.has(file)) continue;
      const source = readFileSync(path.join(ROUTERS, file), 'utf8');

      for (const m of source.matchAll(/\b(?:tx|ctx\.db|db)\s*\.\s*(update|delete)\s*\(/g)) {
        // Statement = from the call to the terminating semicolon at depth 0.
        // Crude but sufficient: these are single chained expressions.
        const start = m.index ?? 0;
        let depth = 0;
        let end = start;
        for (let i = start; i < source.length; i++) {
          const c = source[i];
          if (c === '(' || c === '[' || c === '{') depth++;
          else if (c === ')' || c === ']' || c === '}') depth--;
          else if (c === ';' && depth === 0) { end = i; break; }
        }
        const stmt = source.slice(start, end);

        // A write with no WHERE at all is a different (worse) problem, but it
        // is not what this test is about and would be a deliberate mass update.
        if (!/\.where\s*\(/.test(stmt)) continue;
        if (/orgId/.test(stmt)) continue;

        const line = source.slice(0, start).split('\n').length;
        offenders.push(`${file}:${line} (${m[1]})`);
      }
    }

    expect(
      offenders,
      `These writes are scoped by id alone. RLS would refuse them, but the ` +
        `query must be correct on its own — add eq(table.orgId, ctx.orgId) to ` +
        `the WHERE:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The gate has to be able to fail, or it is decoration. Asserting that the
   * patterns match a known-bad sample proves the regexes still work — including
   * the multi-line case that the original grep could not see.
   */
  it('detects the shapes it claims to detect', () => {
    const multiline = 'const [row] = await ctx.db\n  .update(orders)\n  .set({});';
    const singleLine = 'await db.insert(orders).values({});';
    const auditOnDb = 'await withAudit(ctx.db, async () => row, {});';
    const scoped = 'await ctx.withOrg(async (tx) => tx.update(orders).set({}));';

    expect(findAll(multiline, 'x.ts', new RegExp(UNSCOPED_WRITE))).toHaveLength(1);
    expect(findAll(singleLine, 'x.ts', new RegExp(UNSCOPED_WRITE))).toHaveLength(1);
    expect(findAll(auditOnDb, 'x.ts', new RegExp(UNSCOPED_AUDIT))).toHaveLength(1);
    // The correct form must NOT trip it, or the gate is unusable.
    expect(findAll(scoped, 'x.ts', new RegExp(UNSCOPED_WRITE))).toHaveLength(0);
  });
});
