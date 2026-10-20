/**
 * OR-03 / migration 0085 against real Postgres: order_import_candidates holds
 * one row per provider order version (UNIQUE provider, connection_id,
 * source_order_id, source_updated_at — re-delivery upserts onto it), the
 * CHECKs refuse an off-vocabulary status and a "promoted" row with no order,
 * RLS confines reads and writes to the caller's org, and the (org_id, status,
 * updated_at) index behind the "Import blocked" queue exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { orderImportCandidates, organizations, shopifyConnections, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

const UPDATED_AT = new Date('2026-09-30T10:00:00Z');

let orgA: string;
let orgB: string;
let connA: string;

function candidate(orgId: string, connectionId: string, sourceOrderId: string) {
  return { orgId, connectionId, sourceOrderId, sourceOrderNumber: '#1001', sourceUpdatedAt: UPDATED_AT, apiVersion: '2026-07' };
}

// drizzle wraps driver errors: the SQLSTATE is on err.cause, not err.
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

beforeAll(async () => {
  await truncateAll();
  const stamp = Date.now();
  const [a] = await testDb.insert(organizations).values({ name: 'Import A', slug: `import-a-${stamp}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Import B', slug: `import-b-${stamp}` }).returning();
  orgA = a.id;
  orgB = b.id;
  const [conn] = await testDb.insert(shopifyConnections).values({
    orgId: orgA, shopDomain: `import-a-${stamp}.myshopify.com`, accessTokenCiphertext: 'test-only', accessTokenIv: 'test-only',
    scopes: 'read_orders', apiVersion: '2026-07', pixelIngestionKey: `test-only-${stamp}`,
  }).returning();
  connA = conn.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('order_import_candidates (0085)', () => {
  it('inserts with the defaults, and upserts onto the source-version key', async () => {
    const [row] = await withOrgContext(testDb, orgA, (tx) =>
      tx.insert(orderImportCandidates).values(candidate(orgA, connA, 'gid://shopify/Order/1')).returning());
    expect(row.provider).toBe('shopify');
    expect(row.status).toBe('hydrating');
    expect(row.sections).toEqual({});
    expect(row.blockers).toEqual([]);
    expect(row.attempts).toBe(0);

    const blockers = [{ code: 'line_unmapped', section: 'lines', detail: 'SKU X', nextAction: 'map variant' }];
    const [upserted] = await withOrgContext(testDb, orgA, (tx) =>
      tx.insert(orderImportCandidates).values({ ...candidate(orgA, connA, 'gid://shopify/Order/1'), status: 'blocked', blockers })
        .onConflictDoUpdate({
          target: [orderImportCandidates.provider, orderImportCandidates.connectionId, orderImportCandidates.sourceOrderId, orderImportCandidates.sourceUpdatedAt],
          set: { status: 'blocked', blockers, attempts: sql`${orderImportCandidates.attempts} + 1`, updatedAt: sql`now()` },
        }).returning());
    expect(upserted.id).toBe(row.id);
    expect(upserted.status).toBe('blocked');
    expect(upserted.blockers).toEqual(blockers);
    expect(upserted.attempts).toBe(1);
  });

  it('rejects a plain duplicate of (provider, connection, source_order_id, source_updated_at)', async () => {
    await testDb.insert(orderImportCandidates).values(candidate(orgA, connA, 'gid://shopify/Order/dup'));
    expect(await pgCode(testDb.insert(orderImportCandidates).values(candidate(orgA, connA, 'gid://shopify/Order/dup')))).toBe('23505');
    // A newer provider version of the same order is a new candidate.
    await expect(testDb.insert(orderImportCandidates)
      .values({ ...candidate(orgA, connA, 'gid://shopify/Order/dup'), sourceUpdatedAt: new Date('2026-09-30T11:00:00Z') }))
      .resolves.toBeDefined();
  });

  it('the CHECKs refuse an unknown status and a promoted row without an order', async () => {
    expect(await pgCode(testDb.execute(sql`
      INSERT INTO order_import_candidates (org_id, connection_id, source_order_id, source_updated_at, status)
      VALUES (${orgA}, ${connA}, 'gid://shopify/Order/bad-status', now(), 'done')`))).toBe('23514');
    expect(await pgCode(testDb.insert(orderImportCandidates)
      .values({ ...candidate(orgA, connA, 'gid://shopify/Order/promoted'), status: 'promoted' }))).toBe('23514');
    expect(await pgCode(testDb.execute(sql`
      INSERT INTO order_import_candidates (org_id, connection_id, source_order_id, source_updated_at, blockers)
      VALUES (${orgA}, ${connA}, 'gid://shopify/Order/bad-blockers', now(), '{}'::jsonb)`))).toBe('23514');
  });

  it("RLS hides org A's candidates from org B and refuses writing into org A", async () => {
    const seen = await withOrgContext(testDb, orgB, (tx) => tx.select({ id: orderImportCandidates.id }).from(orderImportCandidates));
    expect(seen).toEqual([]);
    await expect(withOrgContext(testDb, orgB, (tx) =>
      tx.insert(orderImportCandidates).values(candidate(orgA, connA, 'gid://shopify/Order/cross')))).rejects.toBeTruthy();
    const own = await withOrgContext(testDb, orgA, (tx) =>
      tx.select({ id: orderImportCandidates.id }).from(orderImportCandidates).where(eq(orderImportCandidates.orgId, orgA)));
    expect(own.length).toBeGreaterThan(0);
  });

  it('has the (org_id, status, updated_at) index the blocked queue reads through', async () => {
    const rows = await testDb.execute<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'order_import_candidates' AND indexname = 'order_import_candidates_org_status_updated_idx'`);
    expect([...rows]).toHaveLength(1);
    expect(rows[0].indexdef).toContain('(org_id, status, updated_at)');
  });
});
