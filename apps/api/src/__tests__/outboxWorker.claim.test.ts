import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));

import { sendTransactionalEmail } from '../services/integrations';
import { processOutbox } from '../workers/outboxWorker';

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
    claimedAt: null,
  };
}

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'values', 'for']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

beforeEach(() => {
  vi.mocked(sendTransactionalEmail).mockReset().mockResolvedValue({});
});

describe('processOutbox — claim mechanism', () => {
    it('prevents overlapping calls from processing the same event twice', async () => {
        const event = pendingEvent({
            orgId: ORG_ID, inviteId: 'invite-1', email: 'invitee@test.com', orgName: 'IRTH Group',
            role: 'member', otpCode: '482913', joinUrl: 'https://app.irth-house.com/en/join?token=tok',
        });
        
        let selectCalls = 0;
        
        const db = {
            transaction: vi.fn(async (cb) => {
                const tx = {
                    select: vi.fn(() => {
                        selectCalls++;
                        // Only the first call gets the pending event.
                        // The second call simulates that the event has already been claimed (so it returns empty).
                        if (selectCalls === 1) {
                            return chainable([event]);
                        } else {
                            return chainable([]);
                        }
                    }),
                    update: vi.fn(() => chainable(undefined)),
                };
                return cb(tx);
            }),
            update: vi.fn(() => chainable(undefined)),
        };

        // Simulate two overlapping calls
        await Promise.all([
            processOutbox(db as never),
            processOutbox(db as never)
        ]);
        
        // Assert that the email send function was only called once despite two processOutbox calls
        expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    });
});
