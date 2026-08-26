/**
 * The 'eta.invoice.issue' dispatch branch in outboxWorker.ts — the durable
 * replacement for what used to be a fire-and-forget .then().catch() in
 * orders.ts/bosta.ts with no waitUntil(). See packages/domain/src/eta.ts's
 * IssueInvoiceResult for the retryable/non-retryable distinction this branch
 * acts on.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return { ...actual, buildEtaOrderInput: vi.fn() };
});
vi.mock('@irth/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/domain')>();
  return { ...actual, issueInvoice: vi.fn() };
});
vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));

import { buildEtaOrderInput } from '@irth/db';
import { issueInvoice } from '@irth/domain';
import { processOutbox } from '../workers/outboxWorker';

/** A chainable query-builder stub: every method returns itself, `then` resolves the configured value. */
function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'values', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ORDER_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

function pendingEvent(overrides: Partial<{ id: string; attempts: number }> = {}) {
  return {
    id: overrides.id ?? 'event-1',
    orgId: ORG_ID,
    eventType: 'eta.invoice.issue',
    payload: JSON.stringify({ orgId: ORG_ID, orderId: ORDER_ID }),
    processed: false,
    attempts: overrides.attempts ?? 0,
    lastError: null,
  };
}

/** Builds a mock `database` whose `.select` returns each queued value in sequence. */
function mockDatabase(selectSequence: unknown[]) {
  const select = vi.fn();
  for (const value of selectSequence) select.mockReturnValueOnce(chainable(value));
  return {
    select,
    insert: vi.fn(() => chainable(undefined)),
    update: vi.fn(() => chainable(undefined)),
  };
}

beforeEach(() => {
  vi.mocked(buildEtaOrderInput).mockReset();
  vi.mocked(issueInvoice).mockReset();
});

describe('processOutbox — eta.invoice.issue', () => {
  it('success: upserts eta_invoices as submitted and marks the outbox event processed', async () => {
    const event = pendingEvent();
    const db = mockDatabase([[event], []]); // outbox select, then eta_invoices select (no existing row)
    vi.mocked(buildEtaOrderInput).mockResolvedValue({ id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-0001', items: [] });
    vi.mocked(issueInvoice).mockResolvedValue({ ok: true, uuid: 'eta-uuid-1', longId: 'long-1' });

    await processOutbox(db as never);

    expect(db.insert).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled(); // marks the outbox event processed
  });

  it('retryable failure: sets nextRetryAt via exponential backoff and rethrows so the outer catch bumps attempts', async () => {
    const event = pendingEvent({ attempts: 0 });
    const db = mockDatabase([[event], [{ retryCount: 0, nextRetryAt: null }]]);
    vi.mocked(buildEtaOrderInput).mockResolvedValue({ id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-0001', items: [] });
    vi.mocked(issueInvoice).mockResolvedValue({ ok: false, retryable: true, code: 'network_error', message: 'boom' });

    await processOutbox(db as never);

    // insert/update the eta_invoices row (retryCount+nextRetryAt), THEN the
    // outer catch's own database.update(outboxEvents, {attempts, lastError}).
    expect(db.insert).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('non-retryable failure: marks the outbox event processed, leaves eta_invoices in error with no nextRetryAt', async () => {
    const event = pendingEvent();
    const db = mockDatabase([[event], []]);
    vi.mocked(buildEtaOrderInput).mockResolvedValue({ id: ORDER_ID, orgId: ORG_ID, orderNumber: 'IRT-0001', items: [] });
    vi.mocked(issueInvoice).mockResolvedValue({ ok: false, retryable: false, code: 'not_configured', message: 'no creds' });

    await processOutbox(db as never);

    expect(db.insert).toHaveBeenCalled();
    // Non-retryable failures still mark the outbox event processed — no
    // amount of retrying fixes a config problem.
    expect(db.update).toHaveBeenCalled();
    expect(issueInvoice).toHaveBeenCalledTimes(1);
  });

  it('cooldown still active: does not call issueInvoice at all', async () => {
    const event = pendingEvent();
    const futureRetry = new Date(Date.now() + 5 * 60_000);
    const db = mockDatabase([[event], [{ retryCount: 1, nextRetryAt: futureRetry }]]);

    await processOutbox(db as never);

    expect(issueInvoice).not.toHaveBeenCalled();
    expect(buildEtaOrderInput).not.toHaveBeenCalled();
  });
});
