import { beforeEach, describe, expect, it, vi } from 'vitest';

// Handler-level tests for the OR-10 worker (the dispatcher is covered in
// outboxWorker.inboundProcess.test.ts). The db is a scripted fake: select
// results are queued per table, writes are recorded.

const h = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const table = (name: string, cols: string[]) => ({ __table: name, ...Object.fromEntries(cols.map((c) => [c, column(c)])) });
  return {
    inboundDeliveries: table('inbound_deliveries', ['id', 'orgId', 'status', 'error', 'attempts', 'processedAt']),
    orderImportCandidates: table('order_import_candidates', ['id', 'orgId', 'provider', 'connectionId', 'sourceOrderId', 'sourceUpdatedAt', 'status', 'attempts', 'inboundDeliveryId']),
    outboxEvents: table('outbox_events', ['id']),
    shopifyConnections: table('shopify_connections', ['id', 'orgId']),
    variantSourceLinks: table('variant_source_links', ['orgId', 'connectionId', 'state', 'sourceVariantId', 'variantId', 'lineKind']),
    promoteCandidate: vi.fn(),
    hydrateShopifyOrder: vi.fn(),
    normalizeShopifyOrder: vi.fn(),
    validateCandidate: vi.fn(),
    envVar: vi.fn(),
  };
});

vi.mock('../utils/env', () => ({ envVar: h.envVar }));

vi.mock('@irth/db', () => ({
  db: {},
  inboundDeliveries: h.inboundDeliveries,
  orderImportCandidates: h.orderImportCandidates,
  outboxEvents: h.outboxEvents,
  shopifyConnections: h.shopifyConnections,
  variantSourceLinks: h.variantSourceLinks,
  promoteCandidate: h.promoteCandidate,
  withOrgContext: async (database: { tx: unknown }, _orgId: string, fn: (tx: unknown) => unknown) => fn(database.tx),
}));
vi.mock('@irth/domain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irth/domain')>()),
  validateCandidate: h.validateCandidate,
}));
vi.mock('../services/shopifyOrderHydrate', () => ({ hydrateShopifyOrder: h.hydrateShopifyOrder }));
vi.mock('../services/shopifyOrderNormalize', () => ({ normalizeShopifyOrder: h.normalizeShopifyOrder }));

import {
  blockInboundImportAfterExhaustion,
  handleInboundCandidateReprocess,
  handleInboundDeliveryProcess,
  safeErrorMessage,
} from '../workers/inboundProcess';

type Write = { kind: 'insert' | 'update'; table: string; values?: Record<string, unknown>; set?: Record<string, unknown> };

/** A drizzle-shaped chain: every builder method records its args; awaiting it resolves via `done`. */
function chain(done: (state: Record<string, unknown[]>) => unknown) {
  const state: Record<string, unknown[]> = {};
  const proxy: unknown = new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(() => done(state)).then(res, rej);
      }
      return (...args: unknown[]) => { state[String(prop)] = args; return proxy; };
    },
  });
  return proxy;
}

function fakeDb(selects: Record<string, unknown[][]>, inserted: Record<string, unknown[]> = {}) {
  const writes: Write[] = [];
  const name = (t: unknown) => (t as { __table: string }).__table;
  const tx = {
    select: () => chain((s) => selects[name(s.from?.[0])]?.shift() ?? []),
    insert: (t: unknown) => chain((s) => {
      writes.push({ kind: 'insert', table: name(t), values: s.values?.[0] as Record<string, unknown> });
      return inserted[name(t)] ?? [];
    }),
    update: (t: unknown) => chain((s) => {
      writes.push({ kind: 'update', table: name(t), set: s.set?.[0] as Record<string, unknown> });
      return [];
    }),
    execute: async () => [],
  };
  return { database: { tx, ...tx }, writes };
}

const delivery = { id: 'del-1', orgId: 'org-1', provider: 'shopify', connectionId: 'conn-1', status: 'received', payload: { id: 1001, updated_at: '2026-10-01T10:00:00Z' }, triggeredAt: null, receivedAt: new Date('2026-10-01T10:00:01Z'), apiVersion: '2026-07' };
const connection = { id: 'conn-1', orgId: 'org-1', shopDomain: 'test.myshopify.com', apiVersion: '2026-07' };
const normalized = {
  header: { source_order_id: 'gid://shopify/Order/1001', source_updated_at: '2026-10-01T10:00:00Z' },
  lines: [{}, {}],
  evidence: { fetched_at: '2026-10-01T10:00:05Z' },
};
const outboxEvent = (eventType: string) => ({
  id: 'evt-1', orgId: 'org-1', eventType, attempts: 0, processed: false,
  payload: JSON.stringify({ orgId: 'org-1', deliveryId: 'del-1', candidateId: 'cand-1' }),
}) as never;
const blocker = (code: string) => ({ code, section: 'items', detail: 'x', nextAction: 'y' });

describe('handleInboundDeliveryProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.hydrateShopifyOrder.mockResolvedValue({ apiVersion: '2026-07', order: { id: 'gid://shopify/Order/1001' }, sectionsFetch: {}, paginationComplete: true, pages: [] });
    h.normalizeShopifyOrder.mockReturnValue(normalized);
    h.envVar.mockImplementation((key: string) => (key === 'INBOX_PROMOTION_ENABLED' ? '1' : undefined));
  });

  it('with INBOX_PROMOTION_ENABLED unset, stages the candidate and marks the delivery processed but never promotes', async () => {
    h.envVar.mockReturnValue(undefined);
    h.validateCandidate.mockReturnValue({ sections: {}, blockers: [] });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { database, writes } = fakeDb(
      { inbound_deliveries: [[delivery]], shopify_connections: [[connection]], variant_source_links: [[]] },
      { order_import_candidates: [{ id: 'cand-1' }] },
    );

    await handleInboundDeliveryProcess(database as never, outboxEvent('inbound.delivery.process'));

    expect(h.promoteCandidate).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === 'order_import_candidates')?.values).toMatchObject({ status: 'hydrating' });
    expect(writes.filter((w) => w.table === 'inbound_deliveries').map((w) => w.set?.status)).toEqual(['processing', 'processed']);
    expect(writes.some((w) => w.table === 'outbox_events' && w.set?.processed === true)).toBe(true);
    // One structured line, ids only.
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][1]).toEqual({ orgId: 'org-1', candidateId: 'cand-1', outboxEventId: 'evt-1' });
    info.mockRestore();
  });

  it('with the switch off, reprocess also stages without promoting', async () => {
    h.envVar.mockReturnValue('0');
    h.validateCandidate.mockReturnValue({ sections: {}, blockers: [] });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const staged = { id: 'cand-1', orgId: 'org-1', connectionId: 'conn-1', status: 'hydrating', blockers: [], normalized: null, sourceOrderId: 'gid://shopify/Order/1001', inboundDeliveryId: 'del-1', apiVersion: '2026-07' };
    const { database } = fakeDb(
      { order_import_candidates: [[staged]], shopify_connections: [[connection]], variant_source_links: [[]] },
      { order_import_candidates: [{ id: 'cand-1' }] },
    );

    await handleInboundCandidateReprocess(database as never, outboxEvent('inbound.candidate.reprocess'));

    expect(h.promoteCandidate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it('promotes a clean candidate and marks the delivery processed', async () => {
    h.validateCandidate.mockReturnValue({ sections: {}, blockers: [] });
    const { database, writes } = fakeDb(
      { inbound_deliveries: [[delivery]], shopify_connections: [[connection]], variant_source_links: [[]] },
      { order_import_candidates: [{ id: 'cand-1' }] },
    );

    await handleInboundDeliveryProcess(database as never, outboxEvent('inbound.delivery.process'));

    expect(h.hydrateShopifyOrder).toHaveBeenCalledWith(connection, 'gid://shopify/Order/1001');
    const candidate = writes.find((w) => w.kind === 'insert' && w.table === 'order_import_candidates');
    expect(candidate?.values).toMatchObject({ status: 'hydrating', lineCount: 2, sourceOrderId: 'gid://shopify/Order/1001' });
    expect(h.promoteCandidate).toHaveBeenCalledWith(database.tx, { orgId: 'org-1', candidateId: 'cand-1' });
    expect(writes.filter((w) => w.table === 'inbound_deliveries').map((w) => w.set?.status)).toEqual(['processing', 'processed']);
    expect(writes.some((w) => w.table === 'outbox_events' && w.set?.processed === true)).toBe(true);
  });

  it('stores a blocked candidate and never promotes it', async () => {
    h.validateCandidate.mockReturnValue({ sections: {}, blockers: [blocker('line_unmapped')] });
    const { database, writes } = fakeDb(
      { inbound_deliveries: [[delivery]], shopify_connections: [[connection]], variant_source_links: [[]] },
      { order_import_candidates: [{ id: 'cand-1' }] },
    );

    await handleInboundDeliveryProcess(database as never, outboxEvent('inbound.delivery.process'));

    expect(writes.find((w) => w.table === 'order_import_candidates')?.values).toMatchObject({ status: 'blocked' });
    expect(h.promoteCandidate).not.toHaveBeenCalled();
    expect(writes.some((w) => w.table === 'outbox_events' && w.set?.processed === true)).toBe(true);
  });

  it('keeps a hydrate_failed candidate visible but throws so the outbox backs off', async () => {
    h.validateCandidate.mockReturnValue({ sections: {}, blockers: [blocker('hydrate_failed')] });
    const { database, writes } = fakeDb(
      { inbound_deliveries: [[delivery]], shopify_connections: [[connection]], variant_source_links: [[]] },
      { order_import_candidates: [{ id: 'cand-1' }] },
    );

    await expect(handleInboundDeliveryProcess(database as never, outboxEvent('inbound.delivery.process'))).rejects.toThrow('hydrate_failed');

    expect(writes.find((w) => w.table === 'order_import_candidates')?.values).toMatchObject({ status: 'blocked' });
    expect(h.promoteCandidate).not.toHaveBeenCalled();
    expect(writes.some((w) => w.table === 'outbox_events')).toBe(false);
    expect(writes.at(-1)).toMatchObject({ table: 'inbound_deliveries', set: { status: 'failed' } });
  });

  it('skips an already processed delivery without hydrating', async () => {
    const { database } = fakeDb({ inbound_deliveries: [[{ ...delivery, status: 'processed' }]] });
    await handleInboundDeliveryProcess(database as never, outboxEvent('inbound.delivery.process'));
    expect(h.hydrateShopifyOrder).not.toHaveBeenCalled();
  });
});

describe('blockInboundImportAfterExhaustion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks the staged candidate with hydrate_failed and keeps its other blockers', async () => {
    const staged = { id: 'cand-1', orgId: 'org-1', status: 'hydrating', blockers: [blocker('line_unmapped')] };
    const { database, writes } = fakeDb({
      inbound_deliveries: [[delivery]],
      order_import_candidates: [[{ id: 'cand-1' }], [staged]],
    });

    await blockInboundImportAfterExhaustion(database as never, outboxEvent('inbound.delivery.process'), new Error('timeout'));

    expect(writes.find((w) => w.table === 'inbound_deliveries')?.set).toMatchObject({ status: 'blocked' });
    const update = writes.find((w) => w.table === 'order_import_candidates');
    expect(update?.set).toMatchObject({ status: 'blocked', lastError: 'timeout' });
    expect((update?.set?.blockers as Array<{ code: string }>).map((b) => b.code)).toEqual(['line_unmapped', 'hydrate_failed']);
  });

  it('creates a blocked evidence candidate when hydration never staged one', async () => {
    const { database, writes } = fakeDb({ inbound_deliveries: [[delivery]], order_import_candidates: [[]] });

    await blockInboundImportAfterExhaustion(database as never, outboxEvent('inbound.delivery.process'), new Error('timeout'));

    const insert = writes.find((w) => w.kind === 'insert' && w.table === 'order_import_candidates');
    expect(insert?.values).toMatchObject({ status: 'blocked', sourceOrderId: 'gid://shopify/Order/1001', connectionId: 'conn-1' });
    expect((insert?.values?.blockers as Array<{ code: string }>)[0]?.code).toBe('hydrate_failed');
  });

  it('never re-blocks a promoted candidate on reprocess exhaustion', async () => {
    const { database, writes } = fakeDb({ order_import_candidates: [[{ id: 'cand-1', status: 'promoted', blockers: [] }]] });
    await blockInboundImportAfterExhaustion(database as never, outboxEvent('inbound.candidate.reprocess'), new Error('x'));
    expect(writes).toEqual([]);
  });

  it('never throws, even when the db fails', async () => {
    const database = { tx: { select: () => { throw new Error('db down'); } } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(blockInboundImportAfterExhaustion(database as never, outboxEvent('inbound.delivery.process'), new Error('x'))).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('safeErrorMessage', () => {
  it('drops the query params a DrizzleQueryError message carries', () => {
    const err = new Error('Failed query: insert into customers ... params: Jane,jane@example.test', { cause: new Error('duplicate key value') });
    expect(safeErrorMessage(err)).toBe('duplicate key value');
  });
});
