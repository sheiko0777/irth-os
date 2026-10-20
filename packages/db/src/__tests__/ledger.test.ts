import { describe, expect, it, vi } from 'vitest';
import { LedgerImbalanceError, RequiredDimensionError, postJournalEntry } from '../ledger';
import { MissingExchangeRateError } from '../fx';

/**
 * Guarantee 1 only — the pure pre-SQL check in `postJournalEntry`. Guarantee 2
 * (the deferred constraint trigger, which holds regardless of this function)
 * is proved against real Postgres in
 * apps/admin/src/__tests__/integration/ledger.test.ts, and cannot be proved
 * here: a mock cannot fail to hold what a database enforces.
 *
 * A mock this minimal is deliberate: every test below should fail on the
 * balance/shape check BEFORE touching the database at all, so `tx.select` and
 * `tx.insert` throwing if called is the assertion that the guard runs first.
 */
function txThatMustNotBeCalled() {
  return {
    select: vi.fn(() => { throw new Error('select should not run: the balance check must reject first'); }),
    insert: vi.fn(() => { throw new Error('insert should not run: the balance check must reject first'); }),
  };
}

const DIMS = { brandId: 'brand-1', channelId: 'channel-1' };

describe('postJournalEntry — guarantee 1 (pure pre-SQL check)', () => {
  it('rejects an entry whose debits and credits disagree, before any SQL', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'test',
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: 100n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 99n },
      ],
    })).rejects.toBeInstanceOf(LedgerImbalanceError);
  });

  it('rejects an entry with no lines', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'empty',
      lines: [],
    })).rejects.toBeInstanceOf(LedgerImbalanceError);
  });

  it('rejects a line with both debit and credit set — a line must be exactly one side', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'both sides',
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: 100n, creditMinor: 100n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 100n },
      ],
    })).rejects.toThrow(/exactly one of debit\/credit/);
  });

  it('rejects a line with neither debit nor credit set', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'neither side',
      lines: [
        { accountCode: '1010', currency: 'EGP' },
        { accountCode: '4010', currency: 'EGP', creditMinor: 0n },
      ],
    })).rejects.toThrow(/exactly one of debit\/credit/);
  });

  it('rejects a negative amount', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'negative',
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: -100n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 100n },
      ],
    })).rejects.toThrow(RangeError);
  });

  // Was "rejects an entry whose lines do not all share one currency". Ledger
  // v2 (0080) balances in functional currency, so a mixed-currency entry is no
  // longer refused at guarantee 1: it passes the pure check and proceeds to
  // resolve its entity (the first SELECT).
  it('accepts a mixed-currency entry at the guarantee-1 level and proceeds to SQL', async () => {
    let reachedSelect = false;
    const tx = {
      select: vi.fn(() => { reachedSelect = true; throw new Error('stop here — reached SELECT as expected'); }),
      insert: vi.fn(() => { throw new Error('should not reach insert'); }),
    };
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'mixed currency',
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: 100n },
        { accountCode: '1020', currency: 'EUR', creditMinor: 2n },
      ],
    })).rejects.toThrow(/reached SELECT/);
    expect(reachedSelect).toBe(true);
  });

  it('rejects an entry with an unsupported currency', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'unsupported currency',
      lines: [
        { accountCode: '1010', currency: 'USD', debitMinor: 100n },
        { accountCode: '4010', currency: 'USD', creditMinor: 100n },
      ],
    })).rejects.toThrow(/not currently supported by the system/);
  });

  it('rejects a revenue line without brand+channel (RequiredDimensionError), before any SQL', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'sales',
      description: 'no dims',
      lines: [
        { accountCode: '1030', currency: 'EGP', debitMinor: 1000n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 1000n, brandId: 'brand-1' },
      ],
    })).rejects.toSatisfy((e: unknown) => e instanceof RequiredDimensionError && e.missing.join() === 'channelId');
  });

  it('rejects a COGS line without dimensions too', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'sales',
      description: 'no dims',
      lines: [
        { accountCode: '5010', currency: 'EGP', debitMinor: 500n },
        { accountCode: '1040', currency: 'EGP', creditMinor: 500n },
      ],
    })).rejects.toBeInstanceOf(RequiredDimensionError);
  });

  it('rejects an fx rate given by halves', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'general',
      description: 'half a rate',
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: 100n, fxRateNum: 1n },
        { accountCode: '1020', currency: 'EGP', creditMinor: 100n },
      ],
    })).rejects.toThrow(/both fxRateNum and fxRateDen/);
  });

  it('accepts a genuinely balanced multi-line entry and proceeds to resolve accounts', async () => {
    // Balanced, so the guard passes and execution reaches the first SELECT —
    // proving the guard does not also reject VALID entries. Fails past that
    // point (no real db behind this mock), which is fine: this test is only
    // about guarantee 1's boundary, not the rest of the function.
    let reachedSelect = false;
    const tx = {
      select: vi.fn(() => { reachedSelect = true; throw new Error('stop here — reached SELECT as expected'); }),
      insert: vi.fn(() => { throw new Error('should not reach insert'); }),
    };
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'sales',
      description: 'balanced three-line entry',
      dimensions: DIMS,
      lines: [
        { accountCode: '1030', currency: 'EGP', debitMinor: 1140n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 1000n },
        { accountCode: '2030', currency: 'EGP', creditMinor: 140n },
      ],
    })).rejects.toThrow(/reached SELECT/);
    expect(reachedSelect).toBe(true);
  });
});

/**
 * A scripted transaction: each `select()` resolves to the next queued result,
 * each `insert(table).values(v)` is recorded. Enough to drive postJournalEntry
 * end to end without a database.
 */
function scriptedTx(selects: unknown[][]) {
  const queue = [...selects];
  const inserted: unknown[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'onConflictDoNothing', 'returning']) {
      c[m] = () => c;
    }
    c.values = (v: unknown) => { inserted.push(v); return c; };
    c.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject);
    return c;
  };
  return {
    inserted,
    select: vi.fn(() => {
      if (queue.length === 0) throw new Error('unexpected SELECT');
      return chain(queue.shift());
    }),
    insert: vi.fn(() => chain([{ id: 'entry-1' }])),
  };
}

const EGP_ENTITY = [{ legalEntityId: 'le-1', functionalCurrency: 'EGP', channelId: 'ch-1', brandId: 'br-1', warehouseId: 'wh-1' }];
const ACCOUNT_ROWS = [
  { id: 'acc-1010', code: '1010' }, { id: 'acc-1020', code: '1020' },
  { id: 'acc-4010', code: '4010' }, { id: 'acc-5050', code: '5050' },
];

type InsertedLine = {
  accountId: string; currency: string; debitMinor: bigint; creditMinor: bigint;
  functionalCurrency: string; functionalDebitMinor: bigint; functionalCreditMinor: bigint;
  fxRateNum: bigint; fxRateDen: bigint; brandId: string | null; channelId: string | null; legalEntityId: string;
};

describe('postJournalEntry — functional amounts', () => {
  it('computes functional amounts from a caller-supplied num/den', async () => {
    // 1 EUR = 5000/100 EGP. A EUR receipt of 10.00 (1000 minor) = 500.00 EGP.
    const tx = scriptedTx([EGP_ENTITY, [], ACCOUNT_ROWS]);
    await postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'cash',
      description: 'EUR into an EGP entity',
      lines: [
        { accountCode: '1020', currency: 'EUR', debitMinor: 1000n, fxRateNum: 5000n, fxRateDen: 100n },
        { accountCode: '1010', currency: 'EGP', creditMinor: 50000n },
      ],
    });
    const lines = tx.inserted[2] as InsertedLine[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      accountId: 'acc-1020', currency: 'EUR', debitMinor: 1000n,
      functionalCurrency: 'EGP', functionalDebitMinor: 50000n, functionalCreditMinor: 0n,
      fxRateNum: 5000n, fxRateDen: 100n, legalEntityId: 'le-1',
    });
    expect(lines[1]).toMatchObject({
      accountId: 'acc-1010', currency: 'EGP', creditMinor: 50000n,
      functionalCreditMinor: 50000n, fxRateNum: 1n, fxRateDen: 1n,
    });
  });

  it('rejects a mixed-currency entry that does not balance in functional currency, before any INSERT', async () => {
    const tx = scriptedTx([EGP_ENTITY, []]);
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'cash',
      description: 'off by one in EGP',
      lines: [
        { accountCode: '1020', currency: 'EUR', debitMinor: 1000n, fxRateNum: 50n, fxRateDen: 1n },
        { accountCode: '1010', currency: 'EGP', creditMinor: 49999n },
      ],
    })).rejects.toBeInstanceOf(LedgerImbalanceError);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('looks the rate up when the caller gives none, and refuses to guess when there is none', async () => {
    const tx = scriptedTx([EGP_ENTITY, [], []]);
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'cash',
      description: 'no rate on file',
      entryDate: new Date('2026-09-30T10:00:00Z'),
      lines: [
        { accountCode: '1020', currency: 'EUR', debitMinor: 1000n },
        { accountCode: '1010', currency: 'EUR', creditMinor: 1000n },
      ],
    })).rejects.toBeInstanceOf(MissingExchangeRateError);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('posts the rounding residue of a balanced foreign-currency entry to 5050', async () => {
    // 1 EUR = 1/3 EGP (absurd, but it forces rounding). Balanced in EUR:
    // debit 4 -> 1.33 -> 1; credits 2 + 2 -> 0.67 + 0.67 -> 1 + 1 = 2.
    // Functional credit side is 1 larger, so 5050 is debited 1.
    const tx = scriptedTx([EGP_ENTITY, [], [{ num: 1n, den: 3n }], ACCOUNT_ROWS]);
    await postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'cash',
      description: 'rounding',
      lines: [
        { accountCode: '1020', currency: 'EUR', debitMinor: 4n },
        { accountCode: '1010', currency: 'EUR', creditMinor: 2n },
        { accountCode: '1010', currency: 'EUR', creditMinor: 2n },
      ],
    });
    const lines = tx.inserted[2] as InsertedLine[];
    const plug = lines.find((l) => l.accountId === 'acc-5050');
    expect(plug).toMatchObject({ currency: 'EGP', debitMinor: 1n, functionalDebitMinor: 1n, fxRateNum: 1n, fxRateDen: 1n });
    const fDebit = lines.reduce((a, l) => a + l.functionalDebitMinor, 0n);
    const fCredit = lines.reduce((a, l) => a + l.functionalCreditMinor, 0n);
    expect(fDebit).toBe(fCredit);
  });

  it('fills brand/channel from the entity default channel when asked to', async () => {
    const tx = scriptedTx([EGP_ENTITY, [], ACCOUNT_ROWS]);
    await postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'sales',
      description: 'default channel',
      defaultChannel: true,
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: 100n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 100n },
      ],
    });
    const lines = tx.inserted[2] as InsertedLine[];
    expect(lines[1]).toMatchObject({ brandId: 'br-1', channelId: 'ch-1' });
  });

  it('refuses a revenue line when the entity has no channel to default to', async () => {
    const tx = scriptedTx([[{ ...EGP_ENTITY[0], channelId: null, brandId: null, warehouseId: null }]]);
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      entryKind: 'manual',
      journalType: 'sales',
      description: 'no channel',
      defaultChannel: true,
      lines: [
        { accountCode: '1010', currency: 'EGP', debitMinor: 100n },
        { accountCode: '4010', currency: 'EGP', creditMinor: 100n },
      ],
    })).rejects.toBeInstanceOf(RequiredDimensionError);
  });
});
