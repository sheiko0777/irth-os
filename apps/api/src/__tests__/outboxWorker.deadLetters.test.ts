/**
 * Outbox dead-lettering — the generic path, independent of any one event
 * type. campaign.recipient.send's own domain-specific dead-letter
 * finalization (marking the recipient/campaign rows) is covered by
 * outboxWorker.campaignDispatch.test.ts; this file only pins the shared
 * mechanism every event type now gets: a permanently-failed event moves to
 * outbox_dead_letters and out of outbox_events, instead of sitting there
 * forever, unprocessed and invisible, once it crosses the claim query's
 * attempts ceiling.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));

import { sendTransactionalEmail } from '../services/integrations';
import { outboxEvents, outboxDeadLetters } from '@irth/db';
import { processOutbox, OUTBOX_MAX_ATTEMPTS } from '../workers/outboxWorker';

function orgInviteEvent(overrides: { attempts?: number; payload?: string } = {}) {
  return {
    id: 'event-1',
    orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    eventType: 'org.invite.sent',
    payload: overrides.payload ?? JSON.stringify({
      email: 'invitee@test.com', orgName: 'IRTH', role: 'member',
      otpCode: '123456', joinUrl: 'https://example.test/join',
    }),
    processed: false,
    attempts: overrides.attempts ?? 0,
    lastError: null,
    claimedAt: null,
    nextRetryAt: null,
  };
}

/** Claims exactly the given event, then records every insert/delete/update
 * call at the top level (recordEventFailure operates outside any
 * transaction, matching outboxWorker.ts's own real shape). */
function makeDb(event: ReturnType<typeof orgInviteEvent>) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const deletes: { table: unknown }[] = [];
  const updates: { table: unknown; values: unknown }[] = [];

  const chainable = (finalValue: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'for']) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
    return chain;
  };

  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const claimTx = {
        select: vi.fn(() => chainable([event])),
        update: vi.fn(() => chainable(undefined)),
      };
      return cb(claimTx);
    }),
    insert: vi.fn((table: unknown) => {
      const chain = chainable(undefined);
      chain.values = vi.fn((values: unknown) => { inserts.push({ table, values }); return chain; });
      return chain;
    }),
    delete: vi.fn((table: unknown) => {
      deletes.push({ table });
      return chainable(undefined);
    }),
    update: vi.fn((table: unknown) => {
      const chain = chainable(undefined);
      chain.set = vi.fn((values: unknown) => { updates.push({ table, values }); return chain; });
      return chain;
    }),
  };

  return { db, inserts, deletes, updates };
}

beforeEach(() => {
  vi.mocked(sendTransactionalEmail).mockReset();
});

describe('processOutbox — dead-lettering (event-type-agnostic)', () => {
  it(`dead-letters an org.invite.sent event once it exhausts ${OUTBOX_MAX_ATTEMPTS} attempts — not just campaign.recipient.send`, async () => {
    vi.mocked(sendTransactionalEmail).mockRejectedValue(new Error('resend unreachable'));
    const event = orgInviteEvent({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const { db, inserts, deletes, updates } = makeDb(event);

    await processOutbox(db as never);

    const deadLetter = inserts.find((i) => i.table === outboxDeadLetters);
    expect(deadLetter).toBeTruthy();
    const values = deadLetter!.values as Record<string, unknown>;
    expect(values.orgId).toBe(event.orgId);
    expect(values.eventType).toBe('org.invite.sent');
    expect(values.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(values.lastError).toBe('resend unreachable');
    expect(String(values.payload)).toContain('invitee@test.com');

    expect(deletes.some((d) => d.table === outboxEvents)).toBe(true);
    // The exhausting attempt does not also write an attempts-bump update —
    // it is removed from the live queue entirely instead.
    expect(updates.some((u) => u.table === outboxEvents)).toBe(false);
  });

  it('dead-letters an unparseable payload immediately, without waiting for retries to run out', async () => {
    const event = orgInviteEvent({ payload: '{not json' });
    const { db, inserts, deletes } = makeDb(event);

    await processOutbox(db as never);

    const deadLetter = inserts.find((i) => i.table === outboxDeadLetters);
    expect(deadLetter).toBeTruthy();
    expect((deadLetter!.values as Record<string, unknown>).attempts).toBe(1);
    expect(deletes.some((d) => d.table === outboxEvents)).toBe(true);
    // Never reached a handler at all — the send function was never called.
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
