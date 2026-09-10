import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return { ...actual };
});

import { rollupStorefrontMetrics } from '../workers/storefrontRollup';

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['values', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function mockDatabase(sessionRows: any[], eventRows: any[]) {
  const execute = vi.fn()
    .mockResolvedValueOnce(sessionRows)
    .mockResolvedValueOnce(eventRows);

  const insertMock = vi.fn(() => chainable(undefined));

  return {
    execute,
    insert: insertMock,
  };
}

describe('rollupStorefrontMetrics', () => {
  const dayStart = new Date('2023-01-01T00:00:00.000Z');

  it('does nothing if no sessions or events occurred', async () => {
    const db = mockDatabase([], []);

    await rollupStorefrontMetrics(db as never, dayStart);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('batches all row types into a single insert statement', async () => {
    const sessionRows = [
      { org_id: 'org1', value: 10 },
      { org_id: 'org2', value: 25 },
    ];
    const eventRows = [
      { org_id: 'org1', event_name: 'add_to_cart', value: 5 },
      { org_id: 'org2', event_name: 'checkout', value: 2 },
    ];

    const db = mockDatabase(sessionRows, eventRows);

    await rollupStorefrontMetrics(db as never, dayStart);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(1); // One batched call

    const insertChain = db.insert.mock.results[0].value;
    expect(insertChain.values).toHaveBeenCalledTimes(1);

    const passedValues = insertChain.values.mock.calls[0][0];
    expect(passedValues).toHaveLength(4); // 2 session + 2 event

    // Verify mapped shape matches correctly
    expect(passedValues).toEqual([
      expect.objectContaining({ orgId: 'org1', metric: 'sessions', value: 10 }),
      expect.objectContaining({ orgId: 'org2', metric: 'sessions', value: 25 }),
      expect.objectContaining({ orgId: 'org1', metric: 'events:add_to_cart', value: 5, dimensions: { eventName: 'add_to_cart' } }),
      expect.objectContaining({ orgId: 'org2', metric: 'events:checkout', value: 2, dimensions: { eventName: 'checkout' } }),
    ]);

    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});
