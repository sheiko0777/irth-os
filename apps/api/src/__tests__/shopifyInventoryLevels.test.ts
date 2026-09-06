import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middlewares/verifyShopifyWebhook', () => ({
  verifyShopifyWebhook: () => async (c: import('hono').Context, next: () => Promise<void>) => {
    c.set('rawBody', await c.req.text());
    await next();
  },
}));
vi.mock('@irth/db', () => ({
  shopifyConnections: { id: 'connectionId', orgId: 'orgId', shopDomain: 'shopDomain', status: 'status', inventoryLocationId: 'location' },
  shopifyWebhookDeliveries: { id: 'deliveryId', connectionId: 'connectionId', webhookId: 'webhookId', status: 'status' },
  productVariants: { orgId: 'orgId', shopifyInventoryItemId: 'shopifyInventoryItemId' },
  inventoryItems: { id: 'itemId', orgId: 'orgId', variantId: 'variantId' },
  inventoryLevelDiscrepancies: { name: 'discrepancies' },
  inventoryMovements: { name: 'movements' },
  withOrgContext: async (_db: unknown, _orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
    const before = { ...item };
    const discrepancyCount = discrepancies.length;
    try {
      return await fn(fakeDb);
    } catch (error) {
      // Model rollback so a failed insert cannot advance the stream cursor.
      item = before;
      discrepancies.length = discrepancyCount;
      throw error;
    }
  },
}));
vi.mock('../db', () => ({ getDb: () => fakeDb, getEnv: () => ({}) }));

import { inventoryItems, inventoryLevelDiscrepancies, inventoryMovements, productVariants, shopifyConnections, shopifyWebhookDeliveries } from '@irth/db';
import { shopifyWebhookRoute } from '../routes/webhooks/shopify';

const eventTime = '2026-09-06T12:00:00+03:00';
let location: string | null;
let item: { id: string; quantity: number; updatedAt: Date; lastShopifyInventoryEventAt: Date | null };
let discrepancies: Record<string, unknown>[];
let movements: unknown[];
let patches: Record<string, unknown>[];
let deliveries: Map<string, Record<string, unknown>>;
let currentWebhookId: string;
let hasVariant: boolean;
let failInsert: boolean;
const lock = vi.fn();

const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = table === shopifyConnections
          ? [{ id: 'conn-a', orgId: 'org-a', inventoryLocationId: location }]
          : table === productVariants ? (hasVariant ? [{ id: 'variant-a' }] : [])
          : table === inventoryItems ? [item]
          : table === shopifyWebhookDeliveries ? [deliveries.get(currentWebhookId)] : [];
        return Object.assign(Promise.resolve(rows), {
          for: (mode: string) => { lock(mode); return Promise.resolve(rows); },
        });
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      if (table === shopifyWebhookDeliveries) {
        const key = String(row.webhookId);
        if (deliveries.has(key)) throw Object.assign(new Error('duplicate'), { code: '23505' });
        deliveries.set(key, { ...row });
      } else if (table === inventoryLevelDiscrepancies) {
        if (failInsert) throw new Error('discrepancy insert failed');
        discrepancies.push(row);
      } else if (table === inventoryMovements) movements.push(row);
    },
  }),
  update: (table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: async () => {
        if (table === inventoryItems) { patches.push(patch); Object.assign(item, patch); }
        if (table === shopifyWebhookDeliveries) Object.assign(deliveries.get(currentWebhookId)!, patch);
      },
    }),
  }),
};

async function post(overrides: Record<string, unknown> = {}, webhookId = 'wh-1') {
  currentWebhookId = webhookId;
  const response = await shopifyWebhookRoute.request('/inventory-levels-update', {
    method: 'POST',
    headers: { 'x-shopify-shop-domain': 'example.myshopify.com', 'x-shopify-webhook-id': webhookId },
    // Verified against https://shopify.dev/docs/api/webhooks/latest?reference=toml
    // inventory_levels/update: numeric location_id and ISO 8601 updated_at with offset.
    body: JSON.stringify({ inventory_item_id: 123, location_id: 24826418, available: 3, updated_at: eventTime, ...overrides }),
  });
  return response;
}

beforeEach(() => {
  location = 'gid://shopify/Location/24826418';
  item = { id: 'item-a', quantity: 10, updatedAt: new Date('2026-09-07T00:00:00Z'), lastShopifyInventoryEventAt: null };
  discrepancies = [];
  movements = [];
  patches = [];
  deliveries = new Map();
  hasVariant = true;
  failInsert = false;
  lock.mockClear();
});

describe('Shopify inventory reports preserve IRTH stock', () => {
  it.each([['different location', 'gid://shopify/Location/99'], ['no selected location', null]])('skips %s without recording a discrepancy', async (_label, selected) => {
    location = selected;
    expect(await (await post()).json()).toEqual({ data: { skipped: 'location_not_selected' }, error: null, meta: null });
    expect(discrepancies).toHaveLength(0);
    expect(patches).toHaveLength(0);
    expect(movements).toHaveLength(0);
    expect(item.quantity).toBe(10);
    expect(deliveries.get('wh-1')?.status).toBe('processed');
  });

  it.each(['2026-09-06T08:59:59Z', '2026-09-06T09:00:00Z'])('skips old/equal timestamp %s even with a differing count', async (updated_at) => {
    item.lastShopifyInventoryEventAt = new Date(eventTime);
    item.updatedAt = new Date('2026-09-01T00:00:00Z');
    expect(await (await post({ updated_at })).json()).toMatchObject({ data: { skipped: 'stale_event' } });
    expect(discrepancies).toHaveLength(0);
    expect(patches).toHaveLength(0);
    expect(item.quantity).toBe(10);
    expect(deliveries.get('wh-1')?.status).toBe('processed');
  });

  it('captures exactly one fresh mismatch, independently of IRTH updatedAt, without stock writes', async () => {
    item.lastShopifyInventoryEventAt = new Date('2026-09-06T08:00:00Z');
    const originalUpdatedAt = item.updatedAt;
    expect(await (await post()).json()).toEqual({ data: { synced: true }, error: null, meta: null });
    expect(discrepancies).toEqual([{
      orgId: 'org-a', variantId: 'variant-a', locationId: location,
      irthQuantity: 10, shopifyQuantity: 3, eventAt: new Date(eventTime),
    }]);
    expect(item.quantity).toBe(10);
    expect(item.updatedAt).toBe(originalUpdatedAt);
    expect(patches).toEqual([{ lastShopifyInventoryEventAt: new Date(eventTime) }]);
    expect(movements).toHaveLength(0);
    expect(lock).toHaveBeenCalledWith('update');
    expect(deliveries.get('wh-1')?.status).toBe('processed');
  });

  it('a matching report records no mismatch or movement but supersedes older reports', async () => {
    expect(await (await post({ available: 10 })).json()).toMatchObject({ data: { synced: true } });
    expect(discrepancies).toHaveLength(0);
    expect(movements).toHaveLength(0);
    expect(item.quantity).toBe(10);
    expect(item.lastShopifyInventoryEventAt).toEqual(new Date(eventTime));
    item.updatedAt = new Date('2026-09-08T00:00:00Z');
    expect(await (await post({ updated_at: '2026-09-06T08:00:00Z' }, 'wh-2')).json()).toMatchObject({ data: { skipped: 'stale_event' } });
    expect(discrepancies).toHaveLength(0);
  });

  it('redelivery of the same webhook id uses the real delivery claim and does not duplicate discrepancies', async () => {
    await post();
    expect(await (await post()).json()).toEqual({ data: { alreadyProcessed: true }, error: null, meta: null });
    expect(discrepancies).toHaveLength(1);
    expect(deliveries.size).toBe(1);
    expect(patches).toHaveLength(1);
  });

  it('the same event under another delivery id is stale', async () => {
    await post();
    expect(await (await post({}, 'wh-2')).json()).toMatchObject({ data: { skipped: 'stale_event' } });
    expect(discrepancies).toHaveLength(1);
  });

  it('preserves the no matching variant terminal response', async () => {
    hasVariant = false;
    expect(await (await post()).json()).toMatchObject({ data: { skipped: 'no_matching_variant' } });
    expect(deliveries.get('wh-1')?.status).toBe('processed');
  });

  it('marks a failed business operation failed through the existing outer catch', async () => {
    failInsert = true;
    expect((await post()).status).toBe(500);
    expect(deliveries.get('wh-1')?.status).toBe('failed');
    expect(item.lastShopifyInventoryEventAt).toBeNull();
    expect(item.quantity).toBe(10);
    failInsert = false;
    expect(await (await post()).json()).toMatchObject({ data: { synced: true } });
    expect(discrepancies).toHaveLength(1);
    expect(deliveries.get('wh-1')?.status).toBe('processed');
  });

  it('rejects an invalid event timestamp without recording a mismatch or changing stock', async () => {
    expect((await post({ updated_at: 'invalid' })).status).toBe(500);
    expect(deliveries.get('wh-1')?.status).toBe('failed');
    expect(discrepancies).toHaveLength(0);
    expect(patches).toHaveLength(0);
    expect(item.quantity).toBe(10);
  });
});
