import { auditLog, effectiveAccess, variantSourceLinks } from '@irth/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Context } from '@/server/trpc';
import { orderImportRouter } from '@/server/routers/orderImport';
import { mockDb, withOrgMock, idempotentMock } from '../helpers/mockDb';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const CANDIDATE = '11111111-1111-4111-8111-111111111111';
const VARIANT = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';

function ctx(role: 'owner' | 'admin' | 'member' = 'owner'): Context {
  return {
    db: mockDb,
    withOrg: withOrgMock,
    idempotent: idempotentMock,
    session: { user: { id: 'user-1', email: 'u@test.com' } },
    orgId: ORG,
    userId: 'user-1',
    role,
    access: effectiveAccess({ systemKey: role }),
  } as unknown as Context;
}

/** An awaitable query chain that resolves to `value`, whatever is chained on it. */
function rows(value: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin', 'returning', 'values', 'set', 'onConflictDoUpdate', 'onConflictDoNothing']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(value).then(resolve);
  return chain;
}

const candidateRow = {
  id: CANDIDATE,
  connectionId: CONNECTION,
  provider: 'shopify',
  normalized: {
    lines: [
      { source_line_id: 'L1', title: 'Rose Oil', sku_snapshot: 'ROSE-30', source_variant_id: 'gid://shopify/ProductVariant/1' },
      { source_line_id: 'L2', title: 'Gift wrap' },
    ],
  },
};

async function expectCode(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);
}

describe('orderImport router', () => {
  beforeEach(() => mockDb._reset());

  it('permission gate: a member (no orders.write) is refused every op', async () => {
    const caller = orderImportRouter.createCaller(ctx('member'));
    await expectCode(caller.mapLine({ candidateId: CANDIDATE, sourceLineId: 'L1', variantId: VARIANT }), 'FORBIDDEN');
    await expectCode(caller.classifyCustomLine({ candidateId: CANDIDATE, sourceLineId: 'L2', reason: 'wrap' }), 'FORBIDDEN');
    await expectCode(caller.suggestMappings({ candidateId: CANDIDATE }), 'FORBIDDEN');
  });

  it('mapLine: missing candidate is NOT_FOUND and writes nothing', async () => {
    const caller = orderImportRouter.createCaller(ctx('admin'));
    await expectCode(caller.mapLine({ candidateId: CANDIDATE, sourceLineId: 'L1', variantId: VARIANT }), 'NOT_FOUND');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('mapLine: upserts the link on the line\'s source variant and writes an audit row', async () => {
    mockDb.select = vi.fn()
      .mockReturnValueOnce(rows([candidateRow]))
      .mockReturnValueOnce(rows([{ id: VARIANT }])) as never;
    const linkInsert = rows([{ id: 'link-1', variantId: VARIANT }]);
    const auditInsert = rows([]);
    mockDb.insert = vi.fn().mockReturnValueOnce(linkInsert).mockReturnValueOnce(auditInsert) as never;

    const res = await orderImportRouter.createCaller(ctx('owner'))
      .mapLine({ candidateId: CANDIDATE, sourceLineId: 'L1', variantId: VARIANT });

    expect(res.data).toMatchObject({ id: 'link-1' });
    expect(mockDb.insert).toHaveBeenNthCalledWith(1, variantSourceLinks);
    expect(linkInsert.values).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG, connectionId: CONNECTION, sourceVariantId: 'gid://shopify/ProductVariant/1',
      variantId: VARIANT, lineKind: 'mapped', state: 'active', skuSnapshot: 'ROSE-30',
    }));
    expect(mockDb.insert).toHaveBeenNthCalledWith(2, auditLog);
    expect(auditInsert.values).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG, userId: 'user-1', action: 'MAP_IMPORT_LINE', tableName: 'variant_source_links', recordId: 'link-1',
    }));
  });

  it('mapLine: a variant outside the org is NOT_FOUND', async () => {
    mockDb.select = vi.fn()
      .mockReturnValueOnce(rows([candidateRow]))
      .mockReturnValueOnce(rows([])) as never;
    await expectCode(orderImportRouter.createCaller(ctx('owner'))
      .mapLine({ candidateId: CANDIDATE, sourceLineId: 'L1', variantId: VARIANT }), 'NOT_FOUND');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('classifyCustomLine: links a variant-less line by its line key, variant NULL, with the reason audited', async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(rows([candidateRow])) as never;
    const linkInsert = rows([{ id: 'link-2', variantId: null }]);
    const auditInsert = rows([]);
    mockDb.insert = vi.fn().mockReturnValueOnce(linkInsert).mockReturnValueOnce(auditInsert) as never;

    await orderImportRouter.createCaller(ctx('owner'))
      .classifyCustomLine({ candidateId: CANDIDATE, sourceLineId: 'L2', reason: 'gift wrap service' });

    expect(linkInsert.values).toHaveBeenCalledWith(expect.objectContaining({
      sourceVariantId: 'line:L2', variantId: null, lineKind: 'custom_nonstock',
    }));
    expect(auditInsert.values).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CLASSIFY_IMPORT_LINE_CUSTOM', reason: 'gift wrap service',
    }));
  });

  it('suggestMappings: SKU matches first, then title matches, and writes nothing', async () => {
    const skuHit = { variantId: VARIANT, productId: 'p1', sku: 'ROSE-30', variantName: '30ml', productName: 'Rose Oil' };
    const titleHit = { variantId: 'v-other', productId: 'p2', sku: 'ROSE-50', variantName: '50ml', productName: 'Rose Oil' };
    mockDb.select = vi.fn()
      .mockReturnValueOnce(rows([candidateRow]))       // candidate
      .mockReturnValueOnce(rows([]))                   // existing links: none
      .mockReturnValueOnce(rows([skuHit]))             // L1 by SKU
      .mockReturnValueOnce(rows([skuHit, titleHit]))   // L1 by title (dup of SKU hit dropped)
      .mockReturnValueOnce(rows([])) as never;         // L2 by title (no SKU query)

    const res = await orderImportRouter.createCaller(ctx('owner')).suggestMappings({ candidateId: CANDIDATE });

    expect(res.data.map((l) => [l.sourceLineId, l.suggestions.map((s) => [s.variantId, s.match])])).toEqual([
      ['L1', [[VARIANT, 'sku'], ['v-other', 'title']]],
      ['L2', []],
    ]);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('suggestMappings: an already-linked line gets no suggestions', async () => {
    mockDb.select = vi.fn()
      .mockReturnValueOnce(rows([candidateRow]))
      .mockReturnValueOnce(rows([{ key: 'gid://shopify/ProductVariant/1' }, { key: 'line:L2' }])) as never;
    const res = await orderImportRouter.createCaller(ctx('owner')).suggestMappings({ candidateId: CANDIDATE });
    expect(res.data).toEqual([]);
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });
});
