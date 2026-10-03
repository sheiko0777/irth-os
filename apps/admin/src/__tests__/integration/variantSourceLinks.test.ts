/**
 * OR-07 / migration 0088 against real Postgres: variant_source_links is unique
 * per (provider, connection, source_variant_id), its CHECKs tie variant
 * presence to line_kind/state, RLS keeps orgs apart, and the composite
 * same-org FK refuses another org's variant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { organizations, products, productVariants, shopifyConnections, variantSourceLinks, withOrgContext } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;
// One Shopify connection per org until CX-12 drops shopify_connections_org_id_idx.
let connA: string;
let connB: string;
let variantA1: string;
let variantA2: string;
let variantB: string;

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
    scopes: 'read_products', apiVersion: '2026-07', pixelIngestionKey: `test-only-${tag}`,
  }).returning();
  return conn.id;
}

async function variant(orgId: string, sku: string) {
  const [product] = await testDb.insert(products).values({ orgId, name: `Product ${sku}`, sku: `P-${sku}`, priceMinor: 1000n }).returning();
  const [row] = await testDb.insert(productVariants).values({ orgId, productId: product.id, name: '30ml', sku }).returning();
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  const stamp = Date.now();
  const [a] = await testDb.insert(organizations).values({ name: 'Links A', slug: `links-a-${stamp}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Links B', slug: `links-b-${stamp}` }).returning();
  orgA = a.id;
  orgB = b.id;
  connA = await connection(orgA, `links-a-${stamp}`);
  connB = await connection(orgB, `links-b-${stamp}`);
  variantA1 = await variant(orgA, 'ROSE-30');
  variantA2 = await variant(orgA, 'ROSE-50');
  variantB = await variant(orgB, 'ROSE-30');
});

afterAll(async () => {
  await closeTestDb();
});

describe('variant_source_links (0088)', () => {
  it('is unique per (provider, connection, source_variant_id)', async () => {
    const row = { orgId: orgA, connectionId: connA, sourceVariantId: 'gid://shopify/ProductVariant/1', variantId: variantA1 };
    await withOrgContext(testDb, orgA, (tx) => tx.insert(variantSourceLinks).values(row));
    expect(await pgCode(testDb.insert(variantSourceLinks).values({ ...row, variantId: variantA2 }))).toBe('23505');
    // Same source id on another connection, and another provider on the same connection, are distinct links.
    await testDb.insert(variantSourceLinks).values({ orgId: orgB, connectionId: connB, sourceVariantId: row.sourceVariantId, variantId: variantB });
    await testDb.insert(variantSourceLinks).values({ ...row, provider: 'woocommerce', variantId: variantA2 });
  });

  it('ties variant presence to line_kind and state', async () => {
    const base = { orgId: orgA, connectionId: connA };
    // mapped + active needs a variant
    expect(await pgCode(testDb.insert(variantSourceLinks)
      .values({ ...base, sourceVariantId: 'v-no-variant', variantId: null }))).toBe('23514');
    // custom_nonstock must not carry a variant
    expect(await pgCode(testDb.insert(variantSourceLinks)
      .values({ ...base, sourceVariantId: 'v-custom-with', lineKind: 'custom_nonstock', variantId: variantA1 }))).toBe('23514');
    // pending_custom must not carry a variant
    expect(await pgCode(testDb.insert(variantSourceLinks)
      .values({ ...base, sourceVariantId: 'v-pending-with', state: 'pending_custom', variantId: variantA1 }))).toBe('23514');
    // the legal NULL shapes
    await testDb.insert(variantSourceLinks).values({ ...base, sourceVariantId: 'line:L9', lineKind: 'custom_nonstock', variantId: null });
    await testDb.insert(variantSourceLinks).values({ ...base, sourceVariantId: 'v-pending', state: 'pending_custom', variantId: null });
    // unknown enums, bad provider, blank source id
    expect(await pgCode(testDb.execute(sql`
      INSERT INTO variant_source_links (org_id, connection_id, source_variant_id, variant_id, state)
      VALUES (${orgA}, ${connA}, 'v-bad-state', ${variantA1}, 'archived')`))).toBe('23514');
    expect(await pgCode(testDb.execute(sql`
      INSERT INTO variant_source_links (org_id, connection_id, source_variant_id, variant_id, line_kind)
      VALUES (${orgA}, ${connA}, 'v-bad-kind', ${variantA1}, 'bundle')`))).toBe('23514');
    expect(await pgCode(testDb.insert(variantSourceLinks)
      .values({ ...base, provider: 'Shopify!', sourceVariantId: 'v-bad-provider', variantId: variantA1 }))).toBe('23514');
    expect(await pgCode(testDb.insert(variantSourceLinks)
      .values({ ...base, sourceVariantId: '  ', variantId: variantA1 }))).toBe('23514');
  });

  it('composite FK refuses another org\'s variant', async () => {
    expect(await pgCode(testDb.insert(variantSourceLinks)
      .values({ orgId: orgA, connectionId: connA, sourceVariantId: 'v-cross-org', variantId: variantB }))).toBe('23503');
  });

  it('RLS hides another org\'s links and refuses writing them', async () => {
    const seenByB = await withOrgContext(testDb, orgB, (tx) =>
      tx.select({ orgId: variantSourceLinks.orgId }).from(variantSourceLinks));
    expect(seenByB.length).toBeGreaterThan(0);
    expect(seenByB.every((r) => r.orgId === orgB)).toBe(true);
    await expect(withOrgContext(testDb, orgB, (tx) =>
      tx.insert(variantSourceLinks).values({ orgId: orgA, connectionId: connA, sourceVariantId: 'v-rls', variantId: variantA1 }))).rejects.toBeTruthy();
  });
});
