import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { mockDb, withOrgMock } from '../helpers/mockDb';

const { stocktakingRouter } = await import('@/server/routers/stocktaking');

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    session: { user: { id: 'user-1', email: 'u@test.com' }, session: { activeOrganizationId: 'org-1' } },
    orgId: 'org-1',
    userId: 'user-1',
    role,
  } as unknown as Context;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

type DBItem = { id?: string; variantId?: string | null; actualQuantity?: number | null; expectedQuantity?: number; sku?: string; quantity?: number; status?: string };

// Setup mockDb thenable responses for the transaction steps
function setupMockDbComplete(sessionStatus: string, items: DBItem[], variant: DBItem | null = null, invItem: DBItem | null = null) {
    mockDb._reset();
    
    // session update returning
    mockDb.update.mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnValue(
            Promise.resolve(sessionStatus === 'completed' ? [] : [{ id: VALID_UUID, status: 'completed' }])
        )
    } as unknown as Record<string, unknown>);

    // items select returning
    mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        then: (res: (val: unknown) => void) => Promise.resolve(items).then(res)
    } as unknown as Record<string, unknown>);

    let selectMock = mockDb.select;
    for (const item of items) {
        if (!item.variantId) {
             selectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                then: (res: (val: unknown) => void) => Promise.resolve(variant ? [variant] : []).then(res)
            } as unknown as Record<string, unknown>);
        }
        
        if (item.variantId || variant) {
             selectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                then: (res: (val: unknown) => void) => Promise.resolve(invItem ? [invItem] : []).then(res)
            } as unknown as Record<string, unknown>);
        }
    }
}

describe('Stocktaking Reconciliation', () => {
    beforeEach(() => {
        mockDb._reset();
    });

    it('rejects if session already completed (idempotency)', async () => {
        setupMockDbComplete('completed', []);

        const caller = stocktakingRouter.createCaller(ctx('owner'));

        await expect(caller.sessions.complete({ id: VALID_UUID })).rejects.toThrow(TRPCError);
    });

    it('skips items with null actualQuantity', async () => {
        setupMockDbComplete('in_progress', [
            // These would normally not be returned by the DB query due to isNotNull, but we test the logic just in case
            { id: 'item-1', variantId: 'var-1', actualQuantity: null, expectedQuantity: 5, sku: 'SKU1' }
        ]);

        const caller = stocktakingRouter.createCaller(ctx('owner'));
        
        mockDb._reset();
        
        // session update
        mockDb.update.mockReturnValueOnce({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockReturnValue(Promise.resolve([{ id: VALID_UUID, status: 'completed' }]))
        } as unknown as Record<string, unknown>);

        // items query
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'item-1', variantId: 'var-1', actualQuantity: null, expectedQuantity: 5, sku: 'SKU1' }]).then(res)
        } as unknown as Record<string, unknown>);

        // inventory lookup
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'inv-1', quantity: 5 }]).then(res)
        } as unknown as Record<string, unknown>);
        
        // stocktaking items update
        mockDb.update.mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis()
        } as unknown as Record<string, unknown>);

        const result = await caller.sessions.complete({ id: VALID_UUID });
        
        expect(result.summary.absVariance).toBe(5);
    expect(result.summary.netVariance).toBe(-5);
        expect(result.summary.itemsCounted).toBe(1);
    });

    it('calculates variance and updates inventory correctly', async () => {
        mockDb._reset();
        
        mockDb.update.mockReturnValueOnce({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockReturnValue(Promise.resolve([{ id: VALID_UUID, status: 'completed' }]))
        } as unknown as Record<string, unknown>);

        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'item-1', variantId: 'var-1', actualQuantity: 8, expectedQuantity: 5, sku: 'SKU1' }]).then(res)
        } as unknown as Record<string, unknown>);

        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'inv-1', quantity: 5 }]).then(res)
        } as unknown as Record<string, unknown>);
        
        const updateSpy = vi.fn().mockReturnThis();
        mockDb.update.mockReturnValue({
            set: updateSpy,
            where: vi.fn().mockReturnThis()
        } as unknown as Record<string, unknown>);
        
        const insertSpy = vi.fn().mockReturnThis();
        mockDb.insert.mockReturnValue({
            values: insertSpy
        } as unknown as Record<string, unknown>);

        const caller = stocktakingRouter.createCaller(ctx('owner'));
        const result = await caller.sessions.complete({ id: VALID_UUID });

        expect(result.summary.absVariance).toBe(3);
        expect(result.summary.itemsCounted).toBe(1);
        expect(result.summary.itemsApplied).toBe(1);
    });

    it('falls back to sku scoping if variantId is null', async () => {
        mockDb._reset();
        
        mockDb.update.mockReturnValueOnce({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockReturnValue(Promise.resolve([{ id: VALID_UUID, status: 'completed' }]))
        } as unknown as Record<string, unknown>);

        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'item-1', variantId: null, actualQuantity: 10, expectedQuantity: 10, sku: 'SKU2' }]).then(res)
        } as unknown as Record<string, unknown>);

        // Variant lookup
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'var-2' }]).then(res)
        } as unknown as Record<string, unknown>);

        // Inventory lookup
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            then: (res: (val: unknown) => void) => Promise.resolve([{ id: 'inv-2', quantity: 10 }]).then(res)
        } as unknown as Record<string, unknown>);
        
        mockDb.update.mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis()
        } as unknown as Record<string, unknown>);

        const caller = stocktakingRouter.createCaller(ctx('owner'));
        const result = await caller.sessions.complete({ id: VALID_UUID });

        expect(result.summary.absVariance).toBe(0);
        expect(result.summary.itemsApplied).toBe(1);
    });
});
