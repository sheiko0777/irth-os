/**
 * DM-01 / migration 0069 against real Postgres: every org gets its default
 * dimensions from the database (trigger), and the composite (x_id, org_id)
 * FKs make a channel pointing at another org's brand or entity unrepresentable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { organizations, legalEntities, brands, warehouses, channels } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations).values({ name: 'Org A', slug: `dim-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Org B', slug: `dim-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('org dimension defaults (0069)', () => {
  it('seeds one entity, brand, warehouse and channel for a new org and sets the stock owner', async () => {
    const [org] = await testDb.select().from(organizations).where(eq(organizations.id, orgA));
    const entities = await testDb.select().from(legalEntities).where(eq(legalEntities.orgId, orgA));
    const orgBrands = await testDb.select().from(brands).where(eq(brands.orgId, orgA));
    const orgWarehouses = await testDb.select().from(warehouses).where(eq(warehouses.orgId, orgA));
    const orgChannels = await testDb.select().from(channels).where(eq(channels.orgId, orgA));

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ code: 'IRTH', functionalCurrency: 'EGP', documentPrefix: 'IRT', recognitionPoint: 'delivered' });
    expect(orgBrands).toHaveLength(1);
    expect(orgWarehouses).toHaveLength(1);
    expect(orgChannels).toHaveLength(1);
    expect(orgChannels[0]).toMatchObject({
      kind: 'shopify',
      brandId: orgBrands[0].id,
      sellingEntityId: entities[0].id,
      defaultWarehouseId: orgWarehouses[0].id,
    });
    expect(org.stockOwnerEntityId).toBe(entities[0].id);
    expect(org.presentationCurrency).toBe('EGP');
  });

  it("rejects a channel that points at another org's brand", async () => {
    const [entityA] = await testDb.select().from(legalEntities).where(eq(legalEntities.orgId, orgA));
    const [brandB] = await testDb.select().from(brands).where(eq(brands.orgId, orgB));

    await expect(
      testDb.insert(channels).values({
        orgId: orgA,
        code: 'cross-org',
        name: 'Cross org',
        kind: 'pos',
        brandId: brandB.id,
        sellingEntityId: entityA.id,
      }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'channels_brand_same_org_fk' } });
  });

  it('rejects a channel whose selling entity belongs to another org', async () => {
    const [brandA] = await testDb.select().from(brands).where(eq(brands.orgId, orgA));
    const [entityB] = await testDb.select().from(legalEntities).where(eq(legalEntities.orgId, orgB));

    await expect(
      testDb.insert(channels).values({
        orgId: orgA,
        code: 'cross-org-entity',
        name: 'Cross org entity',
        kind: 'pos',
        brandId: brandA.id,
        sellingEntityId: entityB.id,
      }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'channels_entity_same_org_fk' } });
  });
});
