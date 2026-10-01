/**
 * The per-tenant document counter (migration 0036), against real Postgres.
 *
 * These properties are the whole reason it is a counter row rather than a
 * Postgres SEQUENCE, and none of them can be observed against a mock: the row
 * lock, the rollback behaviour and the per-tenant isolation are all database
 * semantics.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { formatDocumentNumber, legalEntities, nextDocumentNumber, organizations, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations)
    .values({ name: 'Counter A', slug: `ctr-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations)
    .values({ name: 'Counter B', slug: `ctr-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('nextDocumentNumber', () => {
  it('counts up from 1', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(await withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'order')));
    }
    expect(seen).toEqual([1, 2, 3]);
  });

  it('keeps each tenant on its own series', async () => {
    // Org A is already at 3. Org B must still start at 1 — the whole point of
    // per-tenant numbering, and what the global unique index on order_number
    // used to make impossible.
    const first = await withOrgContext(testDb, orgB, (tx) => nextDocumentNumber(tx, orgB, 'order'));
    expect(first).toBe(1);
  });

  it('keeps each document kind on its own series', async () => {
    const ret = await withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'return'));
    // Independent of the 3 orders already issued for this org.
    expect(ret).toBe(1);
  });

  it('RELEASES the number when the transaction rolls back', async () => {
    // The property a SEQUENCE does not have. nextval() is non-transactional by
    // design, so a rolled-back order burns its number permanently and the
    // series gains a gap — a question to answer during a tax audit.
    const before = await withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'order'));

    await expect(
      withOrgContext(testDb, orgA, async (tx) => {
        await nextDocumentNumber(tx, orgA, 'order');
        throw new Error('simulated failure after claiming a number');
      }),
    ).rejects.toThrow('simulated failure');

    const after = await withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'order'));

    // The claim inside the failed transaction left no gap.
    expect(after).toBe(before + 1);
  });

  it('never hands the same number to concurrent callers', async () => {
    // The defect this replaced: `SELECT count(*)` then insert count+1. At READ
    // COMMITTED both callers saw N and both built N+1. Ten at once, all on the
    // same (org, kind), is what that could not survive.
    const N = 10;
    const start = await withOrgContext(testDb, orgB, (tx) =>
      nextDocumentNumber(tx, orgB, 'purchase_order'));

    const claimed = await Promise.all(
      Array.from({ length: N }, () =>
        withOrgContext(testDb, orgB, (tx) => nextDocumentNumber(tx, orgB, 'purchase_order'))),
    );

    // Distinct, and contiguous — no duplicates and no gaps.
    expect(new Set(claimed).size).toBe(N);
    expect([...claimed].sort((x, y) => x - y))
      .toEqual(Array.from({ length: N }, (_, i) => start + 1 + i));
  });

  it('is scoped by RLS like every other tenant table', async () => {
    // org_document_counters was created after the 0031 policy loop ran, so it
    // needed its own ENABLE/FORCE/POLICY. If that were forgotten the table
    // would be readable across tenants while looking covered.
    const rows = await withOrgContext(testDb, orgA, async (tx) => {
      const r = await tx.execute<{ org_id: string }>(sql`SELECT org_id FROM org_document_counters`);
      return [...r];
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA)).toBe(true);
  });
});

describe('per-legal-entity series (DM-04, 0081)', () => {
  let defaultEntityA: string;
  let entityA2: string;
  let defaultEntityB: string;

  const defaultEntityOf = async (orgId: string) => {
    const [org] = await testDb.select({ id: organizations.stockOwnerEntityId })
      .from(organizations).where(eq(organizations.id, orgId));
    return org.id!;
  };

  beforeAll(async () => {
    defaultEntityA = await defaultEntityOf(orgA);
    defaultEntityB = await defaultEntityOf(orgB);
    const [e] = await withOrgContext(testDb, orgA, (tx) => tx.insert(legalEntities).values({
      orgId: orgA, code: `E2${Date.now()}`, name: 'Second entity', documentPrefix: 'E2',
    }).returning({ id: legalEntities.id }));
    entityA2 = e.id;
  });

  it('two entities claim invoice concurrently; each series is gapless and independent', async () => {
    const N = 10;
    const claim = (entity: string) =>
      withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'invoice', entity));
    // Interleaved so both series are contended at the same time.
    const claimed = await Promise.all(
      Array.from({ length: 2 * N }, (_, i) =>
        claim(i % 2 === 0 ? defaultEntityA : entityA2).then((n) => ({ entity: i % 2, n }))),
    );
    const series = (entity: number) =>
      claimed.filter((c) => c.entity === entity).map((c) => c.n).sort((x, y) => x - y);
    const oneToN = Array.from({ length: N }, (_, i) => i + 1);
    expect(series(0)).toEqual(oneToN);
    expect(series(1)).toEqual(oneToN);
  });

  it('a rolled-back claim leaves no gap in an entity series', async () => {
    const before = await withOrgContext(testDb, orgA, (tx) =>
      nextDocumentNumber(tx, orgA, 'credit_note', entityA2));
    await expect(
      withOrgContext(testDb, orgA, async (tx) => {
        await nextDocumentNumber(tx, orgA, 'credit_note', entityA2);
        throw new Error('simulated failure after claiming a number');
      }),
    ).rejects.toThrow('simulated failure');
    const after = await withOrgContext(testDb, orgA, (tx) =>
      nextDocumentNumber(tx, orgA, 'credit_note', entityA2));
    expect(after).toBe(before + 1);
  });

  it('omitting the entity continues the default entity series', async () => {
    const implicit = await withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'order'));
    const explicit = await withOrgContext(testDb, orgA, (tx) =>
      nextDocumentNumber(tx, orgA, 'order', defaultEntityA));
    expect(explicit).toBe(implicit + 1);
    // ...and a second entity's order series is untouched by it.
    const other = await withOrgContext(testDb, orgA, (tx) => nextDocumentNumber(tx, orgA, 'order', entityA2));
    expect(other).toBe(1);
  });

  it('keys the counter row by (org, entity, kind)', async () => {
    const rows = await withOrgContext(testDb, orgA, async (tx) => [...await tx.execute<{ legal_entity_id: string }>(sql`
      SELECT legal_entity_id FROM org_document_counters WHERE kind = 'invoice'`)]);
    expect(rows.map((r) => r.legal_entity_id).sort()).toEqual([defaultEntityA, entityA2].sort());
  });

  it('refuses an entity that belongs to another org (composite FK)', async () => {
    await expect(withOrgContext(testDb, orgA, (tx) =>
      nextDocumentNumber(tx, orgA, 'invoice', defaultEntityB))).rejects.toThrow();
  });
});

describe('formatDocumentNumber', () => {
  it('renders each kind the way that kind has always been issued', () => {
    // Orders carry the year, returns do not, purchase orders do. Changing any
    // of these renumbers documents that already exist — and breaks the 0036
    // seed, which reads the TRAILING digits of these exact strings.
    expect(formatDocumentNumber('order', 1, 2026)).toBe('IRT-2026-0001');
    expect(formatDocumentNumber('return', 1)).toBe('RMA-0001');
    expect(formatDocumentNumber('purchase_order', 1, 2026)).toBe('PO-2026-0001');
  });

  it('keeps the trailing digits parseable past four figures', () => {
    // padStart only pads; it does not truncate. The seed regex reads the whole
    // trailing run, so five-digit series continue correctly rather than
    // restarting — which is where the old text-sorted PO lookup broke.
    expect(formatDocumentNumber('order', 10000, 2026)).toBe('IRT-2026-10000');
    expect(/(\d+)$/.exec('IRT-2026-10000')?.[1]).toBe('10000');
  });
});
