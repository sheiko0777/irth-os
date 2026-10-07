import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }));

vi.mock('@irth/db', () => {
  const column = (name: string) => ({ name });
  return {
    db: {},
    auditLog: { id: column('id') },
    outboxEvents: { id: column('id'), processed: column('processed'), attempts: column('attempts'), nextRetryAt: column('nextRetryAt'), claimedAt: column('claimedAt') },
    outboxDeadLetters: { id: column('id') },
    products: { id: column('id'), orgId: column('orgId'), shopifyProductId: column('shopifyProductId') },
    productVariants: { id: column('id'), orgId: column('orgId'), productId: column('productId'), shopifyVariantId: column('shopifyVariantId') },
    etaInvoices: { id: column('id'), orgId: column('orgId'), orderId: column('orderId') },
    shopifyConnections: { id: column('id'), orgId: column('orgId'), status: column('status') },
    campaigns: { id: column('id'), status: column('status'), failedCount: column('failedCount'), deliveredCount: column('deliveredCount') },
    campaignRecipients: { id: column('id'), orgId: column('orgId'), campaignId: column('campaignId'), customerId: column('customerId'), status: column('status') },
    customers: { id: column('id'), name: column('name'), email: column('email'), phone: column('phone') },
    buildEtaOrderInput: vi.fn(),
    claimEtaIssuance: vi.fn(),
  };
});

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/sms', () => ({ sendSms: vi.fn() }));
vi.mock('@irth/emails', () => ({
  renderCampaignEmail: vi.fn(),
  renderOrgInviteEmail: vi.fn(),
  renderOrderConfirmedEmail: vi.fn(),
}));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));
vi.mock('../services/shopifyConnection', () => ({ upsertShopifyProductForConnection: vi.fn() }));
vi.mock('../utils/env', () => ({ envVar: vi.fn() }));
vi.mock('../workers/shopifyOrderReimport', () => ({ handleShopifyOrderReimport: vi.fn() }));
vi.mock('../workers/inboundProcess', () => ({
  handleInboundDeliveryProcess: vi.fn(),
  handleInboundCandidateReprocess: vi.fn(),
  blockInboundImportAfterExhaustion: vi.fn(),
}));

import { dispatchEvent, OUTBOX_MAX_ATTEMPTS, recordEventFailure } from '../workers/outboxWorker';
import {
  blockInboundImportAfterExhaustion,
  handleInboundCandidateReprocess,
  handleInboundDeliveryProcess,
} from '../workers/inboundProcess';

interface Operation {
  kind: 'update' | 'insert' | 'delete';
  table: unknown;
  patch?: Record<string, unknown>;
  row?: unknown;
}

function event(eventType: string, attempts = 0) {
  return {
    id: `evt-${eventType}`,
    orgId: 'org-1',
    eventType,
    payload: JSON.stringify({ orgId: 'org-1', deliveryId: 'delivery-1', candidateId: 'candidate-1' }),
    attempts,
    processed: false,
  } as never;
}

function fakeDb(operations: Operation[] = []) {
  return {
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          operations.push({ kind: 'update', table, patch });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: unknown) => {
        operations.push({ kind: 'insert', table, row });
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        operations.push({ kind: 'delete', table });
      },
    }),
  };
}

describe('outbox inbound process dispatch and failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches inbound.delivery.process to the OR-10 handler', async () => {
    const database = fakeDb();
    const e = event('inbound.delivery.process');

    await dispatchEvent(database as never, e);

    expect(handleInboundDeliveryProcess).toHaveBeenCalledWith(database, e);
  });

  it('dispatches inbound.candidate.reprocess to the OR-10 handler', async () => {
    const database = fakeDb();
    const e = event('inbound.candidate.reprocess');

    await dispatchEvent(database as never, e);

    expect(handleInboundCandidateReprocess).toHaveBeenCalledWith(database, e);
  });

  it('backs off retryable inbound failures without dead-lettering early', async () => {
    const operations: Operation[] = [];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    await recordEventFailure(fakeDb(operations) as never, event('inbound.delivery.process', 1), new Error('hydrate failed'));

    random.mockRestore();
    expect(blockInboundImportAfterExhaustion).not.toHaveBeenCalled();
    const update = operations.find((op) => op.kind === 'update');
    expect(update?.patch).toMatchObject({ attempts: 2, lastError: 'hydrate failed' });
    expect(update?.patch?.nextRetryAt).toBeInstanceOf(Date);
  });

  it('dead-letters exhausted inbound failures and marks the candidate visible-blocked', async () => {
    const operations: Operation[] = [];
    const e = event('inbound.delivery.process', OUTBOX_MAX_ATTEMPTS - 1);

    const failure = new Error('hydrate failed');
    await recordEventFailure(fakeDb(operations) as never, e, failure);

    expect(blockInboundImportAfterExhaustion).toHaveBeenCalledWith(expect.anything(), e, failure);
    expect(operations.some((op) => op.kind === 'insert')).toBe(true);
    expect(operations.some((op) => op.kind === 'delete')).toBe(true);
  });

  it('also blocks the import when the reprocess event exhausts', async () => {
    const e = event('inbound.candidate.reprocess', OUTBOX_MAX_ATTEMPTS - 1);
    await recordEventFailure(fakeDb() as never, e, new Error('boom'));
    expect(blockInboundImportAfterExhaustion).toHaveBeenCalledWith(expect.anything(), e, expect.any(Error));
  });

  it('acks order.accepted and inventory.reserve without touching stock', async () => {
    for (const type of ['order.accepted', 'inventory.reserve']) {
      const operations: Operation[] = [];
      await dispatchEvent(fakeDb(operations) as never, event(type));
      expect(operations).toEqual([{ kind: 'update', table: expect.anything(), patch: expect.objectContaining({ processed: true }) }]);
    }
  });
});
