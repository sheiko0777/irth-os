/**
 * Fails the build if any tRPC router writes outside a tenant-scoped
 * transaction.
 * Reads use an explicit site baseline: establish it before migrating routers,
 * then remove each fixed site. New sites must fail, including in baseline files.
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

/** Includes relational reads, distinct/count queries, raw SQL and CTE entry points. */
const UNSCOPED_READ = /(^|[^.\w])(ctx\s*\.\s*)?db\s*\.\s*(?:(?:select(?:Distinct(?:On)?)?|\$count|execute)\s*\(|query\s*\.|\$with\s*\(|with\s*\()/g;

/**
 * F18 rollout baseline, captured before converting any router reads.
 * Exact file:line sites rather than whole-file exemptions: adding a read to a
 * legacy file must fail too. Shrink this list as sites are moved to withOrg;
 * line-only shifts require review, never regenerate it to accept new reads.
 * API Hono routes are outside this admin-router scanner and need a separate
 * follow-up gate/migration (orders, products, categories, orgs, shipping).
 */
const UNSCOPED_READ_BASELINE = [
  'analytics.ts:26',
  'analytics.ts:55',
  'analytics.ts:93',
  'analytics.ts:154',
  'analytics.ts:158',
  'analytics.ts:162',
  'analytics.ts:166',
  'analytics.ts:175',
  'analytics.ts:179',
  'analytics.ts:232',
  'analytics.ts:263',
  'analytics.ts:287',
  'bulk.ts:149',
  'bulk.ts:168',
  'bulk.ts:187',
  'campaigns.ts:11',
  'campaigns.ts:23',
  'campaigns.ts:105',
  'campaigns.ts:154',
  'categories.ts:11',
  'coupons.ts:50',
  'coupons.ts:57',
  'coupons.ts:70',
  'coupons.ts:210',
  'customerSegments.ts:11',
  'customerSegments.ts:87',
  'customerSegments.ts:94',
  'customerSegments.ts:121',
  'customerSegments.ts:161',
  'customerSegments.ts:169',
  'customerSegments.ts:175',
  'dashboard.ts:60',
  'dashboard.ts:64',
  'dashboard.ts:68',
  'dashboard.ts:72',
  'dashboard.ts:76',
  'dashboard.ts:84',
  'dashboard.ts:93',
  'dashboard.ts:106',
  'dashboard.ts:119',
  'dashboard.ts:186',
  'dashboard.ts:194',
  'dashboard.ts:201',
  'dashboard.ts:222',
  'eta.ts:19',
  'eta.ts:34',
  'eta.ts:103',
  'eta.ts:126',
  'eta.ts:148',
  'finance.ts:38',
  'finance.ts:54',
  'finance.ts:62',
  'finance.ts:71',
  'finance.ts:139',
  'finance.ts:174',
  'finance.ts:218',
  'finance.ts:243',
  'finance.ts:257',
  'finance.ts:272',
  'giftCards.ts:26',
  'giftCards.ts:36',
  'giftCards.ts:151',
  'giftCards.ts:235',
  'giftCards.ts:327',
  'giftCards.ts:371',
  'integrations.ts:42',
  'integrations.ts:90',
  'integrations.ts:154',
  'inventory.ts:30',
  'inventory.ts:46',
  'inventory.ts:68',
  'inventory.ts:94',
  'notifications.ts:17',
  'notifications.ts:24',
  'notifications.ts:58',
  'pricelists.ts:10',
  'pricelists.ts:77',
  'returns.ts:31',
  'returns.ts:37',
  'returns.ts:62',
  'returns.ts:70',
  'returns.ts:400',
  'shipping.ts:13',
  'shipping.ts:67',
  'stocktaking.ts:13',
  'stocktaking.ts:280',
  'stocktaking.ts:295',
];

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

  it('allows only the existing unscoped read baseline', () => {
    const offenders: string[] = [];
    for (const file of routerFiles()) {
      if (CROSS_ORG_BY_DESIGN.has(file)) continue;
      offenders.push(...findAll(readFileSync(path.join(ROUTERS, file), 'utf8'), file, UNSCOPED_READ));
    }
    expect(
      offenders.sort(),
      'Unscoped reads bypass RLS. Move new reads to ctx.withOrg(async (tx) => …); ' +
        'remove fixed sites from UNSCOPED_READ_BASELINE. Current sites: ' + offenders.join(', '),
    ).toEqual([...UNSCOPED_READ_BASELINE].sort());
  });

  it('detects unscoped read shapes across whitespace', () => {
    for (const source of [
      'await ctx.db.select().from(orders);',
      'await ctx.db\n .select().from(orders);',
      'await ctx . db . query . orders.findFirst({});',
      'const { db } = ctx; await db.query.orders.findMany();',
      'await db.selectDistinct().from(orders);',
      'await ctx.db.selectDistinctOn([orders.id]).from(orders);',
      'await ctx.db.$count(orders);',
      'await ctx.db.execute(sql);',
      'ctx.db.$with("orders").as(query);',
      'ctx.db.with(cte).select().from(cte);',
    ]) {
      expect(findAll(source, 'x.ts', UNSCOPED_READ), source).toHaveLength(1);
    }
    expect(findAll('ctx.withOrg(async (tx) => tx.select().from(orders))', 'x.ts', UNSCOPED_READ)).toEqual([]);
    expect(findAll('ctx.withOrg(async (tx) => tx.query.orders.findMany())', 'x.ts', UNSCOPED_READ)).toEqual([]);
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
