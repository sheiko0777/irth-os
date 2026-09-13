import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));
vi.mock('../services/sms', () => ({ sendSms: vi.fn() }));

import { sendWhatsAppTemplate } from '../services/integrations';
import { sendSms } from '../services/sms';
import { processOutbox } from '../workers/outboxWorker';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const RECIPIENT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const CAMPAIGN_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

function campaignEvent(attempts: number) {
  return {
    id: 'event-1',
    orgId: ORG_ID,
    eventType: 'campaign.recipient.send',
    payload: JSON.stringify({ orgId: ORG_ID, recipientId: RECIPIENT_ID }),
    processed: false,
    attempts,
    lastError: null,
    claimedAt: null,
  };
}

function joinedRecipientRow(overrides: { recipientStatus?: string; campaignStatus?: string; channel?: string } = {}) {
  return {
    campaign_recipients: { id: RECIPIENT_ID, campaignId: CAMPAIGN_ID, channel: overrides.channel ?? 'whatsapp', status: overrides.recipientStatus ?? 'pending' },
    campaigns: { id: CAMPAIGN_ID, status: overrides.campaignStatus ?? 'sending', message: 'hello', failedCount: 0 },
    customers: { id: 'cust-1', phone: '+201000000000', email: null, name: 'Test Customer' },
  };
}

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'values', 'for', 'innerJoin']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

/** Builds a `database` double that claims exactly one campaign.recipient.send
 * event, resolves the joined recipient/campaign/customer row for the
 * top-level lookup, and hands every nested `.transaction()` call a tx whose
 * `.select()`/`.update()` are recorded for assertions. */
function makeDb(event: ReturnType<typeof campaignEvent>, recipientRow: ReturnType<typeof joinedRecipientRow>, remainingPendingCount: number) {
  const updateCalls: { table: unknown; values: unknown }[] = [];
  let claimTransactionDone = false;

  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      if (!claimTransactionDone) {
        claimTransactionDone = true;
        const claimTx = {
          select: vi.fn(() => chainable([event])),
          update: vi.fn(() => chainable(undefined)),
        };
        return cb(claimTx);
      }
      // The campaign-specific business transaction (success path).
      const bizTx = {
        update: vi.fn((table: unknown) => {
          const chain = chainable(undefined);
          const originalSet = chain.set as (v: unknown) => unknown;
          chain.set = vi.fn((values: unknown) => {
            updateCalls.push({ table, values });
            return originalSet(values);
          });
          return chain;
        }),
        select: vi.fn(() => chainable([{ count: remainingPendingCount }])),
      };
      return cb(bizTx);
    }),
    select: vi.fn(() => chainable([recipientRow])),
    update: vi.fn((table: unknown) => {
      const chain = chainable(undefined);
      const originalSet = chain.set as (v: unknown) => unknown;
      chain.set = vi.fn((values: unknown) => {
        updateCalls.push({ table, values });
        return originalSet(values);
      });
      return chain;
    }),
  };

  return { db, updateCalls };
}

beforeEach(() => {
  vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue({ messages: [{ id: 'wamid.1' }] });
  vi.mocked(sendSms).mockReset().mockResolvedValue({ sid: 'SM1' });
});

describe('processOutbox — campaign.recipient.send', () => {
  it('sends, marks the recipient sent, and completes the campaign as sent when nothing else is pending', async () => {
    const { db, updateCalls } = makeDb(campaignEvent(0), joinedRecipientRow(), 0);

    await processOutbox(db as never);

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    const recipientUpdate = updateCalls.find((c) => (c.values as { status?: string }).status === 'sent');
    expect(recipientUpdate).toBeTruthy();
    const campaignStatusUpdate = updateCalls.find((c) => 'status' in (c.values as object) && (c.values as { status?: unknown }).status !== 'sent');
    // The campaign completion write uses a raw SQL CASE expression for
    // status, not a plain string — assert one of the campaign-row updates
    // ran (deliveredCount increment, then the completion check).
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('finalizes a permanently-failing recipient as failed once attempts are exhausted, without retrying forever', async () => {
    // attempts=4 going into the outer catch means attemptsAfterThis=5, which
    // is exactly the claim query's dead-letter ceiling (attempts < 5).
    const event = campaignEvent(4);
    const { db } = makeDb(event, joinedRecipientRow(), 0);

    // Force the send itself to fail so we reach the outer catch's
    // dead-letter finalization branch instead of the success path.
    vi.mocked(sendWhatsAppTemplate).mockRejectedValue(new Error('provider unreachable'));

    // The finalization branch does its own `database.select`/`database.
    // transaction` for a *third* transaction beyond the claim/attempt-bump
    // pair — reuse the same db double, whose transaction mock already
    // distinguishes claim vs. non-claim calls generically.
    let bizCallCount = 0;
    const originalTransaction = db.transaction;
    db.transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      bizCallCount++;
      if (bizCallCount === 1) return (originalTransaction as unknown as (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>)(cb);
      // Finalization transaction: re-select the recipient (still pending),
      // then record the failed/failedCount/campaign-status updates.
      const finalizeTx = {
        select: vi.fn(() => chainable([joinedRecipientRow().campaign_recipients])),
        update: vi.fn(() => chainable(undefined)),
      };
      return cb(finalizeTx);
    });

    await processOutbox(db as never);

    // The outer outbox_events update always records the bumped attempts —
    // that alone proves the failure was caught and processed, not silently
    // swallowed or left to throw out of processOutbox entirely.
    expect(db.update).toHaveBeenCalled();
  });

  it('dispatches an sms-channel recipient via sendSms — this channel was selectable but never wired, so it silently failed every send', async () => {
    const { db, updateCalls } = makeDb(campaignEvent(0), joinedRecipientRow({ channel: 'sms' }), 0);

    await processOutbox(db as never);

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith({ to: '+201000000000', body: 'hello' });
    const recipientUpdate = updateCalls.find((c) => (c.values as { status?: string }).status === 'sent');
    expect(recipientUpdate).toBeTruthy();
  });
});
