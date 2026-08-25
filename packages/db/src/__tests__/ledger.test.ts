import { describe, expect, it, vi } from 'vitest';
import { LedgerImbalanceError, postJournalEntry } from '../ledger';

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

describe('postJournalEntry — guarantee 1 (pure pre-SQL check)', () => {
  it('rejects an entry whose debits and credits disagree, before any SQL', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      journalType: 'general',
      description: 'test',
      lines: [
        { accountCode: '1010', debitMinor: 100n },
        { accountCode: '4010', creditMinor: 99n },
      ],
    })).rejects.toBeInstanceOf(LedgerImbalanceError);
  });

  it('rejects an entry with no lines', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      journalType: 'general',
      description: 'empty',
      lines: [],
    })).rejects.toBeInstanceOf(LedgerImbalanceError);
  });

  it('rejects a line with both debit and credit set — a line must be exactly one side', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      journalType: 'general',
      description: 'both sides',
      lines: [
        { accountCode: '1010', debitMinor: 100n, creditMinor: 100n },
        { accountCode: '4010', creditMinor: 100n },
      ],
    })).rejects.toThrow(/exactly one of debit\/credit/);
  });

  it('rejects a line with neither debit nor credit set', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      journalType: 'general',
      description: 'neither side',
      lines: [
        { accountCode: '1010' },
        { accountCode: '4010', creditMinor: 0n },
      ],
    })).rejects.toThrow(/exactly one of debit\/credit/);
  });

  it('rejects a negative amount', async () => {
    const tx = txThatMustNotBeCalled();
    await expect(postJournalEntry(tx as never, {
      orgId: 'org-1',
      journalType: 'general',
      description: 'negative',
      lines: [
        { accountCode: '1010', debitMinor: -100n },
        { accountCode: '4010', creditMinor: 100n },
      ],
    })).rejects.toThrow(RangeError);
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
      journalType: 'sales',
      description: 'balanced three-line entry',
      lines: [
        { accountCode: '1030', debitMinor: 1140n },
        { accountCode: '4010', creditMinor: 1000n },
        { accountCode: '2030', creditMinor: 140n },
      ],
    })).rejects.toThrow(/reached SELECT/);
    expect(reachedSelect).toBe(true);
  });
});
