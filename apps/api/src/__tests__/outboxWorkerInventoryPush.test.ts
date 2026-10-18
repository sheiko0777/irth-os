import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn(() => 'ACTIVE') }));
vi.mock('../services/shopifyConnection', () => ({
  upsertShopifyProductForConnection: vi.fn(),
  setConnectionInventoryQuantity: vi.fn(),
}));
vi.mock('../db', () => ({ getEnv: () => ({}) }));

import { setConnectionInventoryQuantity } from '../services/shopifyConnection';
import { processOutbox } from '../workers/outboxWorker';

const ORG = 'org-a';
const INVENTORY_ITEM_GID = 'gid://shopify/InventoryItem/9001';
const CONNECTION = { id: 'conn-1', orgId: ORG, status: 'active', inventoryLocationId: 'gid://shopify/Location/42' };

function chainable(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit', 'for', 'set']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

// select() results are consumed in call order: the claimed event first, then the
// handler's reads in the order it makes them (variant, connection, stock total).
function mockDatabase(opts: {
  payloadOrgId?: string;
  variant?: unknown[];
  connection?: unknown[];
  stock?: unknown[];
}) {
  const event = {
    id: 'event-1', orgId: ORG, eventType: 'inventory.push',
    payload: JSON.stringify({ orgId: opts.payloadOrgId ?? ORG, variantId: 'variant-1' }), processed: false, attempts: 2,
  };
  const select = vi.fn();
  for (const rows of [
    [event],
    opts.variant ?? [{ id: 'variant-1', shopifyInventoryItemId: INVENTORY_ITEM_GID }],
    opts.connection ?? [CONNECTION],
    opts.stock ?? [{ total: '7' }],
  ]) select.mockReturnValueOnce(chainable(rows));
  const set = vi.fn(() => chainable(undefined));
  return {
    select,
    set,
    update: vi.fn(() => ({ set })),
    transaction: vi.fn(async (cb) => cb({ select, update: vi.fn(() => chainable(undefined)) })),
  };
}

beforeEach(() => {
  vi.mocked(setConnectionInventoryQuantity).mockReset().mockResolvedValue(undefined);
});

describe('outbox inventory.push', () => {
  it('pushes the current absolute quantity to the connected location', async () => {
    const db = mockDatabase({ stock: [{ total: '7' }] });

    await expect(processOutbox(db as never)).resolves.toBe(1);

    expect(setConnectionInventoryQuantity).toHaveBeenCalledExactlyOnceWith(CONNECTION, INVENTORY_ITEM_GID, 7);
    expect(db.set).toHaveBeenCalledExactlyOnceWith({ processed: true, processedAt: expect.any(Date) });
  });

  it('never tells Shopify a negative quantity', async () => {
    const db = mockDatabase({ stock: [{ total: '-3' }] });

    await processOutbox(db as never);

    expect(setConnectionInventoryQuantity).toHaveBeenCalledExactlyOnceWith(CONNECTION, INVENTORY_ITEM_GID, 0);
  });

  it('pushes zero when the variant has no stock rows', async () => {
    const db = mockDatabase({ stock: [] });

    await processOutbox(db as never);

    expect(setConnectionInventoryQuantity).toHaveBeenCalledExactlyOnceWith(CONNECTION, INVENTORY_ITEM_GID, 0);
  });

  it.each([
    ['the variant is not linked to a Shopify inventory item', { variant: [{ id: 'variant-1', shopifyInventoryItemId: null }] }],
    ['the variant no longer exists', { variant: [] }],
    ['the org has no active connection', { connection: [] }],
    ['the connection has no location selected', { connection: [{ ...CONNECTION, inventoryLocationId: null }] }],
  ])('skips and marks processed when %s', async (_name, opts) => {
    const db = mockDatabase(opts);

    await expect(processOutbox(db as never)).resolves.toBe(1);

    expect(setConnectionInventoryQuantity).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledExactlyOnceWith({ processed: true, processedAt: expect.any(Date) });
  });

  it('refuses a payload that names a different org than the event', async () => {
    const db = mockDatabase({ payloadOrgId: 'org-b' });

    await processOutbox(db as never);

    expect(setConnectionInventoryQuantity).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledExactlyOnceWith({
      attempts: 3,
      lastError: expect.stringContaining('does not match event org'),
      nextRetryAt: expect.any(Date),
    });
  });

  it('lets a Shopify failure fail the event so it is retried, not swallowed', async () => {
    vi.mocked(setConnectionInventoryQuantity).mockRejectedValueOnce(new Error('Shopify said no'));
    const db = mockDatabase({});

    await processOutbox(db as never);

    expect(db.set).toHaveBeenCalledExactlyOnceWith({
      attempts: 3,
      lastError: expect.stringContaining('Shopify said no'),
      nextRetryAt: expect.any(Date),
    });
  });
});
