/**
 * DM-02 / migration 0070 against real Postgres: lookupRate returns the latest
 * rate on or before the date, never another org's rate, and refuses to guess.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { organizations, exchangeRates, lookupRate, MissingExchangeRateError } from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await truncateAll();
  const [a] = await testDb.insert(organizations).values({ name: 'FX A', slug: `fx-a-${Date.now()}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'FX B', slug: `fx-b-${Date.now()}` }).returning();
  orgA = a.id;
  orgB = b.id;
  await testDb.insert(exchangeRates).values([
    { orgId: orgA, base: 'EUR', quote: 'EGP', rateNum: 530000n, rateDen: 10000n, asOf: '2026-09-01', source: 'cbe' },
    { orgId: orgA, base: 'EUR', quote: 'EGP', rateNum: 535000n, rateDen: 10000n, asOf: '2026-09-15', source: 'cbe' },
    { orgId: orgB, base: 'EUR', quote: 'EGP', rateNum: 999999n, rateDen: 10000n, asOf: '2026-09-20', source: 'manual' },
  ]);
});

afterAll(async () => {
  await closeTestDb();
});

describe('lookupRate (0070)', () => {
  it('picks the latest rate on or before the date', async () => {
    expect(await lookupRate(testDb, orgA, 'EUR', 'EGP', '2026-09-10')).toMatchObject({ num: 530000n, den: 10000n });
    expect(await lookupRate(testDb, orgA, 'EUR', 'EGP', '2026-09-15')).toMatchObject({ num: 535000n });
    expect(await lookupRate(testDb, orgA, 'EUR', 'EGP', '2026-12-31')).toMatchObject({ num: 535000n });
  });

  it("never returns another org's rate", async () => {
    expect(await lookupRate(testDb, orgA, 'EUR', 'EGP', '2026-09-25')).toMatchObject({ num: 535000n });
  });

  it('throws MissingExchangeRateError before the first rate and for unknown pairs', async () => {
    await expect(lookupRate(testDb, orgA, 'EUR', 'EGP', '2026-08-31')).rejects.toBeInstanceOf(MissingExchangeRateError);
    await expect(lookupRate(testDb, orgA, 'SAR', 'EGP', '2026-09-20')).rejects.toBeInstanceOf(MissingExchangeRateError);
  });

  it('is the identity for the same currency', async () => {
    expect(await lookupRate(testDb, orgA, 'EGP', 'EGP', '2026-09-20')).toMatchObject({ num: 1n, den: 1n });
  });

  it('rejects a non-positive rate at the database', async () => {
    await expect(
      testDb.insert(exchangeRates).values({ orgId: orgA, base: 'AED', quote: 'EGP', rateNum: 0n, rateDen: 1n, asOf: '2026-09-01', source: 'manual' }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'exchange_rates_positive_ck' } });
  });
});
