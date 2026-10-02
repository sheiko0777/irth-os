/**
 * DM-06 / migration 0087 against real Postgres: customer_identities dedupes on
 * (org, kind, connection, external_id) with NULLS NOT DISTINCT, the same email
 * on two connections is two identities, composite same-org FKs and RLS keep
 * orgs apart, customer_merges is append-only for irth_app and the owner, and
 * suggestMerge ranks candidates by identity strength without merging.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  brands, customerBrandRelationships, customerIdentities, customerMerges, customers, organizations, shopifyConnections,
  findCustomerByIdentity, suggestMerge, upsertIdentity, withOrgContext,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;
let connA1: string;
let connA2: string;
let custA1: string;
let custA2: string;
let custA3: string;
let custA4: string;
let custB: string;

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

async function connection(orgId: string, tag: string) {
  const [conn] = await testDb.insert(shopifyConnections).values({
    orgId, shopDomain: `${tag}.myshopify.com`, accessTokenCiphertext: 'test-only', accessTokenIv: 'test-only',
    scopes: 'read_customers', apiVersion: '2026-07', pixelIngestionKey: `test-only-${tag}`,
  }).returning();
  return conn.id;
}

async function customer(orgId: string, name: string) {
  const [row] = await testDb.insert(customers).values({ orgId, name }).returning();
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  const stamp = Date.now();
  const [a] = await testDb.insert(organizations).values({ name: 'Ident A', slug: `ident-a-${stamp}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Ident B', slug: `ident-b-${stamp}` }).returning();
  orgA = a.id;
  orgB = b.id;
  connA1 = await connection(orgA, `ident-a1-${stamp}`);
  connA2 = await connection(orgA, `ident-a2-${stamp}`);
  custA1 = await customer(orgA, 'Ana One');
  custA2 = await customer(orgA, 'Ana Two');
  custA3 = await customer(orgA, 'Ana Three');
  custA4 = await customer(orgA, 'Ana Four');
  custB = await customer(orgB, 'Other Org');
});

afterAll(async () => {
  await closeTestDb();
});

describe('customer_identities (0087)', () => {
  it('upsertIdentity is insert-or-nothing and normalises emails', async () => {
    const first = await withOrgContext(testDb, orgA, (tx) =>
      upsertIdentity(tx, orgA, { customerId: custA1, kind: 'email', connectionId: connA1, externalId: ' Ana@Example.com ' }));
    expect(first).toMatchObject({ externalId: 'ana@example.com', verified: false, customerId: custA1 });
    const again = await withOrgContext(testDb, orgA, (tx) =>
      upsertIdentity(tx, orgA, { customerId: custA1, kind: 'email', connectionId: connA1, externalId: 'ANA@example.com' }));
    expect(again?.id).toBe(first?.id);
    const found = await withOrgContext(testDb, orgA, (tx) =>
      findCustomerByIdentity(tx, orgA, { kind: 'email', connectionId: connA1, externalId: 'ana@EXAMPLE.com' }));
    expect(found).toBe(custA1);
  });

  it('the same email on a second connection is a second identity, not a silent link', async () => {
    const other = await withOrgContext(testDb, orgA, (tx) =>
      upsertIdentity(tx, orgA, { customerId: custA2, kind: 'email', connectionId: connA2, externalId: 'ana@example.com' }));
    expect(other?.customerId).toBe(custA2);
    const rows = await testDb.select().from(customerIdentities)
      .where(eq(customerIdentities.externalId, 'ana@example.com'));
    expect(new Set(rows.map((r) => r.customerId))).toEqual(new Set([custA1, custA2]));
  });

  it('rejects a duplicate key, including two connection-less identities (NULLS NOT DISTINCT)', async () => {
    const row = { orgId: orgA, customerId: custA3, kind: 'phone' as const, externalId: '+201000000001' };
    await testDb.insert(customerIdentities).values(row);
    expect(await pgCode(testDb.insert(customerIdentities).values({ ...row, customerId: custA4 }))).toBe('23505');
    await testDb.insert(customerIdentities).values({ ...row, connectionId: connA1 });
    expect(await pgCode(testDb.insert(customerIdentities).values({ ...row, connectionId: connA1 }))).toBe('23505');
  });

  it('refuses an unknown kind and a blank external id', async () => {
    expect(await pgCode(testDb.execute(sql`
      INSERT INTO customer_identities (org_id, customer_id, kind, external_id)
      VALUES (${orgA}, ${custA1}, 'fax', 'x')`))).toBe('23514');
    expect(await pgCode(testDb.insert(customerIdentities)
      .values({ orgId: orgA, customerId: custA1, kind: 'email', externalId: '   ' }))).toBe('23514');
  });

  it('keeps orgs apart: composite FK refuses a foreign customer, RLS hides and refuses rows', async () => {
    expect(await pgCode(testDb.insert(customerIdentities)
      .values({ orgId: orgA, customerId: custB, kind: 'email', externalId: 'b@example.com' }))).toBe('23503');
    const seen = await withOrgContext(testDb, orgB, (tx) => tx.select({ id: customerIdentities.id }).from(customerIdentities));
    expect(seen).toEqual([]);
    await expect(withOrgContext(testDb, orgB, (tx) =>
      tx.insert(customerIdentities).values({ orgId: orgA, customerId: custA1, kind: 'email', externalId: 'x@example.com' }))).rejects.toBeTruthy();
    expect(await withOrgContext(testDb, orgB, (tx) =>
      findCustomerByIdentity(tx, orgA, { kind: 'email', connectionId: connA1, externalId: 'ana@example.com' }))).toBeNull();
  });
});

describe('customer_brand_relationships (0087)', () => {
  it('one row per (customer, brand); a brand from another org is refused', async () => {
    const [brandA] = await testDb.insert(brands).values({ orgId: orgA, code: 'A', name: 'Brand A' }).returning();
    const [brandB] = await testDb.insert(brands).values({ orgId: orgB, code: 'B', name: 'Brand B' }).returning();
    const [rel] = await withOrgContext(testDb, orgA, (tx) =>
      tx.insert(customerBrandRelationships).values({ orgId: orgA, customerId: custA1, brandId: brandA.id }).returning());
    expect(rel).toMatchObject({ marketingConsent: false, orderCount: 0, spentMinor: 0n });
    expect(await pgCode(testDb.insert(customerBrandRelationships)
      .values({ orgId: orgA, customerId: custA1, brandId: brandA.id }))).toBe('23505');
    expect(await pgCode(testDb.insert(customerBrandRelationships)
      .values({ orgId: orgA, customerId: custA2, brandId: brandB.id }))).toBe('23503');
  });
});

describe('customer_merges (0087)', () => {
  it('is append-only for irth_app and for the owner role', async () => {
    const [merge] = await withOrgContext(testDb, orgA, (tx) =>
      tx.insert(customerMerges).values({ orgId: orgA, winnerId: custA1, loserId: custA2, mergedBy: 'test', reason: 'same person' }).returning());
    expect(merge.mergedAt).toBeInstanceOf(Date);

    expect(await pgCode(withOrgContext(testDb, orgA, (tx) =>
      tx.update(customerMerges).set({ reason: 'edited' }).where(eq(customerMerges.id, merge.id))))).toBe('42501');
    expect(await pgCode(withOrgContext(testDb, orgA, (tx) =>
      tx.delete(customerMerges).where(eq(customerMerges.id, merge.id))))).toBe('42501');
    expect(await pgCode(testDb.update(customerMerges).set({ reason: 'edited' }).where(eq(customerMerges.id, merge.id)))).toBe('42501');
    expect(await pgCode(testDb.delete(customerMerges).where(eq(customerMerges.id, merge.id)))).toBe('42501');

    const [still] = await testDb.select().from(customerMerges).where(eq(customerMerges.id, merge.id));
    expect(still.reason).toBe('same person');
  });

  it('refuses a self-merge and a cross-org loser', async () => {
    expect(await pgCode(testDb.insert(customerMerges).values({ orgId: orgA, winnerId: custA1, loserId: custA1 }))).toBe('23514');
    expect(await pgCode(testDb.insert(customerMerges).values({ orgId: orgA, winnerId: custA1, loserId: custB }))).toBe('23503');
  });
});

describe('suggestMerge', () => {
  it('ranks by identity strength and changes nothing', async () => {
    // custA1: email ana@ (connA1) from above, plus a phone shared with custA3.
    // custA2: email ana@ (connA2) + verified Shopify id   -> strength 3
    // custA3: phone +201000000001 (no connection, above)  -> strength 2
    // custA4: connection-less email ana@                  -> strength 1
    await withOrgContext(testDb, orgA, async (tx) => {
      await upsertIdentity(tx, orgA, { customerId: custA1, kind: 'phone', connectionId: connA2, externalId: '+201000000001' });
      await upsertIdentity(tx, orgA, { customerId: custA2, kind: 'shopify', connectionId: connA2, externalId: 'gid://shopify/Customer/2', verified: true });
      await upsertIdentity(tx, orgA, { customerId: custA4, kind: 'email', connectionId: null, externalId: 'ana@example.com' });
    });
    const before = await testDb.select({ n: sql<number>`count(*)::int` }).from(customerIdentities);

    const suggestions = await withOrgContext(testDb, orgA, (tx) => suggestMerge(tx, orgA, custA1));
    expect(suggestions.map((s) => [s.customerId, s.strength])).toEqual([[custA2, 3], [custA3, 2], [custA4, 1]]);
    expect(suggestions[1].matchedOn).toEqual(['phone']);

    const after = await testDb.select({ n: sql<number>`count(*)::int` }).from(customerIdentities);
    expect(after[0].n).toBe(before[0].n);
    expect(await withOrgContext(testDb, orgB, (tx) => suggestMerge(tx, orgB, custA1))).toEqual([]);
  });
});
