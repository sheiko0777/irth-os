/**
 * Guards against the schema drifting away from the database.
 *
 * Drizzle silently omits any column its table definition does not declare. When
 * that column is `NOT NULL` with no default, every insert fails at runtime with
 * `23502` — and the mocked unit suite cannot see it, because `mockDb` accepts
 * any shape you hand it.
 *
 * This is not hypothetical. `product_variants.org_id` was added by migration
 * 0027 and never added to the Drizzle table, so creating a product variant
 * through `apps/api/src/routes/products.ts` failed outright. Nothing caught it
 * until this suite existed.
 *
 * The required-column set is read from the live database rather than a pasted
 * snapshot, so it cannot rot: add a NOT NULL column in a migration and forget
 * the schema, and this fails on the next run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Table, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { organizations, products, productVariants } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

/** Not tenant data: Better Auth owns these, and the runner owns the rest. */
const NOT_OURS = new Set([
  '_migrations',
  '_integration_marker',
  'account',
  'session',
  'user',
  'verification',
  'jwks',
  'organization',
  'member',
  'invitation',
  'project_config',
]);

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});

describe('schema drift', () => {
  it('declares every column the database requires on insert', async () => {
    const rows = await testDb.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND is_nullable = 'NO'
        AND column_default IS NULL
      ORDER BY table_name, column_name
    `);

    const required = [...rows].filter((r) => !NOT_OURS.has(r.table_name));
    expect(required.length).toBeGreaterThan(50); // the query actually ran

    // Reflect over the real schema through drizzle's own API rather than its
    // internal symbols: `is(x, Table)` filters out the non-table exports
    // (withAudit, createDb, enums) that share the barrel.
    const declared = new Map<string, Set<string>>();
    for (const value of Object.values(await import('@irth/db'))) {
      if (!is(value, Table)) continue;
      declared.set(
        getTableName(value),
        new Set(Object.values(getTableColumns(value)).map((c) => c.name)),
      );
    }
    expect(declared.size).toBeGreaterThan(20); // the reflection actually worked

    const missing = required
      .filter((r) => declared.has(r.table_name) && !declared.get(r.table_name)!.has(r.column_name))
      .map((r) => `${r.table_name}.${r.column_name}`);

    expect(
      missing,
      `Column(s) the database requires but Drizzle never declares. Every insert into these tables fails with 23502 at runtime:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('can actually create a product variant', async () => {
    // The end-to-end proof for the org_id defect above: this exact insert used
    // to fail with `null value in column "org_id" violates not-null constraint`.
    const [org] = await testDb
      .insert(organizations)
      .values({ name: 'Variant Org', slug: `variant-org-${Date.now()}` })
      .returning();

    const [product] = await testDb
      .insert(products)
      .values({
        orgId: org.id,
        name: 'Probe Product',
        sku: `SKU-${Date.now()}`,
        priceMinor: 1999n,
      })
      .returning();

    const [variant] = await testDb
      .insert(productVariants)
      .values({
        orgId: org.id,
        productId: product.id,
        name: 'Probe Variant',
        sku: `VSKU-${Date.now()}`,
        priceMinor: 999n,
      })
      .returning();

    expect(variant.id).toBeTruthy();
    expect(variant.orgId).toBe(org.id);
    expect(variant.priceMinor).toBe(999n);
  });
});
