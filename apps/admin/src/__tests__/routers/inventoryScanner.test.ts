import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@/server/trpc';
import { inventoryRouter } from '@/server/routers/inventory';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

function ctx(role: 'owner' | 'admin' | 'member' = 'admin'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

function chainOf(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'update', 'set', 'insert', 'values']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

beforeEach(() => {
  mockDb._reset();
});

describe('inventory router — scanner & barcode features', () => {
  it('lookupByBarcode: resolves matching variant and strips irth:sku: prefix', async () => {
    const caller = inventoryRouter.createCaller(ctx('admin'));

    const mockRow = {
      variant: { id: 'var-1', name: 'Large', sku: 'SHIRT-BLU-L', priceMinor: 5000n },
      product: { id: 'prod-1', name: 'T-Shirt', nameAr: 'تيشيرت', priceMinor: 5000n },
      item: { id: 'item-1', quantity: 25, reorderPoint: 5 },
    };

    mockDb.select.mockReturnValueOnce(chainOf([mockRow]));

    const result = await caller.lookupByBarcode({ code: 'irth:sku:SHIRT-BLU-L' });

    expect(result.found).toBe(true);
    expect(result.item?.sku).toBe('SHIRT-BLU-L');
    expect(result.item?.quantity).toBe(25);
    expect(result.item?.productName).toBe('T-Shirt');
  });

  it('lookupByBarcode: returns found=false if code is unknown', async () => {
    const caller = inventoryRouter.createCaller(ctx('admin'));

    // Both variant and product queries return empty
    mockDb.select.mockReturnValueOnce(chainOf([]));
    mockDb.select.mockReturnValueOnce(chainOf([]));

    const result = await caller.lookupByBarcode({ code: 'NON-EXISTENT-SKU' });
    expect(result.found).toBe(false);
    expect(result.item).toBeNull();
  });

  it('batchAdjust: executes multiple item adjustments inside a transaction', async () => {
    const caller = inventoryRouter.createCaller(ctx('admin'));

    const existingItems = [
      { id: '11111111-1111-4111-8111-111111111111', quantity: 10, orgId: 'org-1' },
      { id: '22222222-2222-4222-8222-222222222222', quantity: 5, orgId: 'org-1' },
    ];

    mockDb.select.mockReturnValueOnce(chainOf(existingItems));
    mockDb.update.mockReturnValue(chainOf([]));
    mockDb.insert.mockReturnValue(chainOf([]));

    const result = await caller.batchAdjust({
      type: 'in',
      items: [
        { itemId: '11111111-1111-4111-8111-111111111111', quantity: 3 },
        { itemId: '22222222-2222-4222-8222-222222222222', quantity: 2 },
      ],
      note: 'استلام بضاعة',
    });

    expect(result.data.success).toBe(true);
    expect(result.data.count).toBe(2);
  });
});
