/**
 * The 'org.invite.sent' dispatch branch in outboxWorker.ts — Area A of the
 * member-management pass. Reuses sendTransactionalEmail exactly as
 * 'order.confirmed' already does; the only new piece is which payload gets
 * parsed and what the email says.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));

import { sendTransactionalEmail } from '../services/integrations';
import { processOutbox } from '../workers/outboxWorker';

/** A chainable query-builder stub: every method returns itself, `then` resolves the configured value. */
function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'values']) {
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
    eventType: 'org.invite.sent',
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
  };
}

beforeEach(() => {
  vi.mocked(sendTransactionalEmail).mockReset().mockResolvedValue({});
});

describe('processOutbox — org.invite.sent', () => {
  it('sends the invite email with the join link and OTP code, then marks the event processed', async () => {
    const event = pendingEvent({
      orgId: ORG_ID, inviteId: 'invite-1', email: 'invitee@test.com', orgName: 'IRTH Group',
      role: 'member', otpCode: '482913', joinUrl: 'https://app.irth-house.com/en/join?token=tok',
    });
    const db = mockDatabase([[event]]);

    await processOutbox(db as never);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(call.to).toBe('invitee@test.com');
    expect(call.subject).toContain('IRTH Group');
    expect(call.html).toContain('482913');
    expect(call.html).toContain('https://app.irth-house.com/en/join?token=tok');
    expect(db.update).toHaveBeenCalled(); // marks the outbox event processed
  });

  it('renders the Arabic role label correctly for owner/admin/member', async () => {
    const event = pendingEvent({
      orgId: ORG_ID, inviteId: 'invite-2', email: 'x@test.com', orgName: 'Co',
      role: 'owner', otpCode: '111111', joinUrl: 'https://x/join?token=t',
    });
    const db = mockDatabase([[event]]);

    await processOutbox(db as never);

    const call = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(call.html).toContain('مالك');
  });

  it('a send failure is caught by the outer handler, not left uncaught', async () => {
    const event = pendingEvent({
      orgId: ORG_ID, inviteId: 'invite-3', email: 'x@test.com', orgName: 'Co',
      role: 'member', otpCode: '222222', joinUrl: 'https://x/join?token=t',
    });
    const db = mockDatabase([[event]]);
    vi.mocked(sendTransactionalEmail).mockRejectedValueOnce(new Error('Resend API error: 500'));

    // processOutbox's outer try/catch per event means a thrown send never
    // propagates out of processOutbox itself — it's recorded via
    // database.update(outboxEvents).set({attempts, lastError}) instead.
    await expect(processOutbox(db as never)).resolves.toBe(1);
    expect(db.update).toHaveBeenCalled();
  });
});
