import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn(() => 'ACTIVE') }));
vi.mock('../services/shopifyConnection', () => ({ upsertShopifyProductForConnection: vi.fn() }));
vi.mock('../db', () => ({ getEnv: () => ({}) }));

import { upsertShopifyProduct } from '../services/shopify';
import { upsertShopifyProductForConnection } from '../services/shopifyConnection';
import { processOutbox } from '../workers/outboxWorker';
import { outboxEvents } from '@irth/db';

function chainable(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

function mockDatabase(orgId: string, connections: unknown[] = []) {
  const event = {
    id: 'event-1', orgId, eventType: 'shopify.product.push',
    payload: JSON.stringify({ orgId, productId: 'product-1' }), processed: false, attempts: 2,
  };
  const select = vi.fn();
  for (const rows of [
    [event],
    [{ id: 'product-1', orgId, name: 'Product', status: 'active', priceMinor: 1000n, currency: 'EGP', shopifyProductId: 'gid://shopify/Product/1' }],
    [{ id: 'variant-1', sku: 'SKU-1', priceMinor: 1000n }],
    connections,
  ]) select.mockReturnValueOnce(chainable(rows));
  const set = vi.fn(() => chainable(undefined));
  return { select, set, update: vi.fn(() => ({ set })) };
}

beforeEach(() => {
  vi.stubEnv('SHOPIFY_ORG_ID', 'legacy-org');
  const result = { shopifyProductId: 'gid://shopify/Product/1', variants: [] };
  vi.mocked(upsertShopifyProduct).mockReset().mockResolvedValue(result);
  vi.mocked(upsertShopifyProductForConnection).mockReset().mockResolvedValue(result);
});
afterEach(() => vi.unstubAllEnvs());

describe('Shopify outbox legacy fallback', () => {
  it.each(['legacy-org', undefined])('refuses another org without an active connection (legacy org: %s)', async (legacyOrg) => {
    vi.stubEnv('SHOPIFY_ORG_ID', legacyOrg);
    const db = mockDatabase('other-org');

    await expect(processOutbox(db as never)).resolves.toBe(1);

    expect(upsertShopifyProduct).not.toHaveBeenCalled();
    expect(upsertShopifyProductForConnection).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledExactlyOnceWith(outboxEvents);
    expect(db.set).toHaveBeenCalledExactlyOnceWith({
      attempts: 3,
      lastError: expect.stringContaining('Shopify product push for org other-org has no active connection'),
    });
  });

  it('allows the configured legacy org to use the global client', async () => {
    const db = mockDatabase('legacy-org');
    await processOutbox(db as never);
    expect(upsertShopifyProduct).toHaveBeenCalledTimes(1);
    expect(upsertShopifyProductForConnection).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledExactlyOnceWith({ processed: true, processedAt: expect.any(Date) });
  });

  it.each(['other-org', 'legacy-org'])('prefers the active connection for %s', async (orgId) => {
    const connection = { id: 'conn-1', orgId, status: 'active' };
    const db = mockDatabase(orgId, [connection]);
    await processOutbox(db as never);
    expect(upsertShopifyProduct).not.toHaveBeenCalled();
    expect(upsertShopifyProductForConnection).toHaveBeenCalledExactlyOnceWith(connection, expect.objectContaining({ title: 'Product' }));
    expect(db.set).toHaveBeenCalledExactlyOnceWith({ processed: true, processedAt: expect.any(Date) });
  });
});
