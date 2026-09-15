/**
 * The 'order.confirmed' email branch in outboxWorker.ts had no dedicated
 * test — 'org.invite.sent' does (outboxWorker.orgInvite.test.ts), this one
 * didn't, even though both call sendTransactionalEmail the same way. Fills
 * that gap using the identical harness.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));

import { sendTransactionalEmail, sendWhatsAppTemplate } from '../services/integrations';
import { processOutbox } from '../workers/outboxWorker';

/** A chainable query-builder stub: every method returns itself, `then` resolves the configured value. */
function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'values', 'for']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function pendingEvent(payload: Record<string, unknown>) {
  return {
    id: 'event-1',
    orgId: ORG_ID,
    eventType: 'order.confirmed',
    payload: JSON.stringify(payload),
    processed: false,
    attempts: 0,
    lastError: null,
  };
}

function mockDatabase(selectSequence: unknown[]) {
  const select = vi.fn();
  for (const value of selectSequence) select.mockReturnValueOnce(chainable(value));
  return {
    select,
    insert: vi.fn(() => chainable(undefined)),
    update: vi.fn(() => chainable(undefined)),
    transaction: vi.fn(async (cb) => {
      return cb({ select, update: vi.fn(() => chainable(undefined)) });
    }),
  };
}

beforeEach(() => {
  vi.mocked(sendTransactionalEmail).mockReset().mockResolvedValue({});
  vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue({});
});

describe('processOutbox — order.confirmed', () => {
  it('sends the order-confirmed email with the customer name and order number, then marks the event processed', async () => {
    const event = pendingEvent({
      customerPhone: '',
      customerEmail: 'buyer@test.com',
      customerName: 'سارة أحمد',
      orderNumber: 'ORD-1042',
    });
    const db = mockDatabase([[event]]);

    await processOutbox(db as never);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(call.to).toBe('buyer@test.com');
    expect(call.subject).toContain('ORD-1042');
    expect(call.html).toContain('سارة أحمد');
    expect(call.html).toContain('ORD-1042');
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled(); // marks the outbox event processed
  });

  it('falls back to a generic greeting when customerName is missing', async () => {
    const event = pendingEvent({
      customerPhone: '',
      customerEmail: 'buyer2@test.com',
      orderNumber: 'ORD-2',
    });
    const db = mockDatabase([[event]]);

    await processOutbox(db as never);

    const call = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(call.html).toContain('عميلنا العزيز');
  });

  it('skips the email branch entirely when customerEmail is absent (WhatsApp-only order)', async () => {
    const event = pendingEvent({
      customerPhone: '+201234567890',
      orderNumber: 'ORD-3',
    });
    const db = mockDatabase([[event]]);

    await processOutbox(db as never);

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });
});
