import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/integrations', () => ({ sendWhatsAppTemplate: vi.fn(), sendTransactionalEmail: vi.fn() }));
vi.mock('../services/shopify', () => ({ upsertShopifyProduct: vi.fn(), statusFromLocal: vi.fn() }));

import { sendTransactionalEmail } from '../services/integrations';
import { processOutbox } from '../workers/outboxWorker';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const baseTime = new Date('2026-09-07T10:00:00.000Z');

function chainable(finalValue: unknown, onSet?: (value: Record<string, unknown>) => void) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit', 'for']) chain[method] = vi.fn(() => chain);
  chain.set = vi.fn((value: Record<string, unknown>) => {
    onSet?.(value);
    return chain;
  });
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function retryDatabase() {
  const event = {
    id: 'event-1', orgId: ORG_ID, eventType: 'org.invite.sent',
    payload: JSON.stringify({ email: 'invitee@test.com', orgName: 'IRTH', role: 'member', otpCode: '123456', joinUrl: 'https://example.test/join' }),
    processed: false, attempts: 0, lastError: null, claimedAt: null, nextRetryAt: null as Date | null,
  };
  const claimable = () => !event.processed && event.attempts < 5
    && (!event.nextRetryAt || event.nextRetryAt <= new Date());
  const update = vi.fn(() => chainable(undefined, (values) => Object.assign(event, values)));
  const database = {
    transaction: vi.fn(async (callback) => callback({
      select: vi.fn(() => chainable(claimable() ? [event] : [])),
      update: vi.fn(() => chainable(undefined, (values) => Object.assign(event, values))),
    })),
    update,
  };
  return { database, event };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(baseTime);
  vi.mocked(sendTransactionalEmail).mockReset();
});

describe('processOutbox — shared retry backoff', () => {
  it('does not re-claim a failed non-ETA event until its shared cooldown has passed', async () => {
    const { database, event } = retryDatabase();
    vi.mocked(sendTransactionalEmail).mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(processOutbox(database as never)).resolves.toBe(1);
    expect(event.attempts).toBe(1);
    expect(event.nextRetryAt).toEqual(new Date(baseTime.getTime() + 2 * 60_000));

    await expect(processOutbox(database as never)).resolves.toBe(0);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);

    // The F11 claim lease is deliberately five minutes, so retry after both
    // the shared cooldown and the existing lease have elapsed.
    vi.setSystemTime(baseTime.getTime() + 5 * 60_000);
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({});
    await expect(processOutbox(database as never)).resolves.toBe(1);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(event.processed).toBe(true);
  });
});
