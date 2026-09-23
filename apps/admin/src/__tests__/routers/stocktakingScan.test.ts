import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@/server/trpc';
import { stocktakingRouter } from '@/server/routers/stocktaking';
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
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy', 'update', 'set', 'insert', 'values', 'returning']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

beforeEach(() => {
  mockDb._reset();
});

describe('stocktaking router — recordScan procedure', () => {
  const SESSION_ID = '11111111-1111-4111-8111-111111111111';

  it('recordScan: increments existing item actualQuantity and computes variance', async () => {
    const caller = stocktakingRouter.createCaller(ctx('admin'));

    const mockSession = { id: SESSION_ID, status: 'in_progress', orgId: 'org-1' };
    const existingItem = {
      id: 'item-1',
      sessionId: SESSION_ID,
      sku: 'SKU-001',
      productName: 'Hoodie',
      expectedQuantity: 10,
      actualQuantity: 4,
      variance: -6,
    };
    const updatedItem = {
      ...existingItem,
      actualQuantity: 5,
      variance: -5,
    };

    // 1. session select
    mockDb.select.mockReturnValueOnce(chainOf([mockSession]));
    // 2. existingItem select
    mockDb.select.mockReturnValueOnce(chainOf([existingItem]));
    // 3. update returning
    mockDb.update.mockReturnValueOnce(chainOf([updatedItem]));

    const result = await caller.recordScan({
      sessionId: SESSION_ID,
      code: 'irth:sku:SKU-001',
      quantityDelta: 1,
    });

    expect(result.isNew).toBe(false);
    expect(result.data.actualQuantity).toBe(5);
    expect(result.data.variance).toBe(-5);
  });

  it('recordScan: rejects when session is already completed', async () => {
    const caller = stocktakingRouter.createCaller(ctx('admin'));

    const completedSession = { id: SESSION_ID, status: 'completed', orgId: 'org-1' };
    mockDb.select.mockReturnValueOnce(chainOf([completedSession]));

    await expect(
      caller.recordScan({
        sessionId: SESSION_ID,
        code: 'SKU-001',
        quantityDelta: 1,
      })
    ).rejects.toThrow('جلسة الجرد غير نشطة أو مكتملة بالفعل');
  });

  it('recordScan: rejects a negative delta that would push the count below zero', async () => {
    const caller = stocktakingRouter.createCaller(ctx('admin'));
    mockDb.select.mockReturnValueOnce(chainOf([{ id: SESSION_ID, status: 'in_progress', orgId: 'org-1' }]));
    mockDb.select.mockReturnValueOnce(chainOf([{ id: 'item-1', sku: 'SKU-001', expectedQuantity: 10, actualQuantity: 1 }]));

    await expect(
      caller.recordScan({ sessionId: SESSION_ID, code: 'SKU-001', quantityDelta: -2 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('recordScan: rejects a first scan with a negative delta', async () => {
    const caller = stocktakingRouter.createCaller(ctx('admin'));
    mockDb.select.mockReturnValueOnce(chainOf([{ id: SESSION_ID, status: 'in_progress', orgId: 'org-1' }]));
    mockDb.select.mockReturnValueOnce(chainOf([]));

    await expect(
      caller.recordScan({ sessionId: SESSION_ID, code: 'SKU-001', quantityDelta: -1 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
