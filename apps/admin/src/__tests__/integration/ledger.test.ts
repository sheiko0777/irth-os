/**
 * The double-entry ledger against real Postgres — proving what a mock cannot.
 *
 * Guarantee 1 (postJournalEntry's pure pre-SQL check) is unit-tested in
 * packages/db/src/__tests__/ledger.test.ts. This file proves guarantee 2: the
 * DEFERRABLE CONSTRAINT TRIGGER on journal_lines rejects an unbalanced entry
 * regardless of what wrote it — including a raw INSERT that bypasses
 * postJournalEntry entirely, which is exactly the scenario the trigger exists
 * for. A constraint nobody has seen fail is not known to work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  accounts,
  journalEntries,
  journalLines,
  organizations,
  postJournalEntry,
  reverseJournalEntry,
  withOrgContext,
  ACCOUNT_CODES,
  ensureChartOfAccounts,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgId: string;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Ledger Org', slug: `ledger-${Date.now()}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  await closeTestDb();
});

const sqlState = (err: unknown): string | undefined => {
  for (let e = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

describe('guarantee 2 — the deferred constraint trigger', () => {
  it('rejects a raw unbalanced insert at COMMIT, bypassing postJournalEntry entirely', async () => {
    // This is the scenario the trigger exists for: not "did our own function
    // make a mistake" (guarantee 1 already covers that) but "does the
    // database refuse an unbalanced entry no matter what wrote it."
    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await ensureChartOfAccounts(tx, orgId);
        const [cash] = await tx.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.CASH))).limit(1);
        const [revenue] = await tx.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.SALES_REVENUE))).limit(1);

        const [entry] = await tx.insert(journalEntries).values({
          orgId, journalType: 'general', description: 'deliberately unbalanced',
        }).returning({ id: journalEntries.id });

        // 100 debited, only 99 credited — the trigger must catch this even
        // though every individual row satisfies journal_lines_side_check
        // (each row is still exactly one side, just the totals disagree).
        await tx.insert(journalLines).values([
          { orgId, entryId: entry.id, accountId: cash.id, debitMinor: 100n, creditMinor: 0n },
          { orgId, entryId: entry.id, accountId: revenue.id, debitMinor: 0n, creditMinor: 99n },
        ]);
        // No error yet — DEFERRED means it fires at commit (transaction end),
        // not at the INSERT itself. withOrgContext's own commit is what trips it.
      });
    } catch (err) {
      code = sqlState(err);
    }
    // check_violation, per the trigger's explicit ERRCODE.
    expect(code).toBe('23514');
  });

  it('accepts a genuinely balanced raw insert', async () => {
    const rows = await withOrgContext(testDb, orgId, async (tx) => {
      await ensureChartOfAccounts(tx, orgId);
      const [cash] = await tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.CASH))).limit(1);
      const [revenue] = await tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.SALES_REVENUE))).limit(1);

      const [entry] = await tx.insert(journalEntries).values({
        orgId, journalType: 'general', description: 'balanced raw insert',
      }).returning({ id: journalEntries.id });

      return tx.insert(journalLines).values([
        { orgId, entryId: entry.id, accountId: cash.id, debitMinor: 500n, creditMinor: 0n },
        { orgId, entryId: entry.id, accountId: revenue.id, debitMinor: 0n, creditMinor: 500n },
      ]).returning({ id: journalLines.id });
    });
    expect(rows).toHaveLength(2);
  });

  it('rejects a line that is both debit and credit at once (journal_lines_side_check)', async () => {
    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await ensureChartOfAccounts(tx, orgId);
        const [cash] = await tx.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.CASH))).limit(1);
        const [entry] = await tx.insert(journalEntries).values({
          orgId, journalType: 'general', description: 'both sides',
        }).returning({ id: journalEntries.id });
        await tx.insert(journalLines).values([
          { orgId, entryId: entry.id, accountId: cash.id, debitMinor: 100n, creditMinor: 100n },
        ]);
      });
    } catch (err) {
      code = sqlState(err);
    }
    expect(code).toBe('23514');
  });
});

describe('guarantee 3 — journal_entries and journal_lines are insert-only', () => {
  it('refuses UPDATE on journal_lines for the app role', async () => {
    const [{ id: lineId }] = await withOrgContext(testDb, orgId, async (tx) => {
      await ensureChartOfAccounts(tx, orgId);
      const [cash] = await tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.CASH))).limit(1);
      const [revenue] = await tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.SALES_REVENUE))).limit(1);
      const [entry] = await tx.insert(journalEntries).values({
        orgId, journalType: 'general', description: 'immutability check',
      }).returning({ id: journalEntries.id });
      return tx.insert(journalLines).values([
        { orgId, entryId: entry.id, accountId: cash.id, debitMinor: 10n, creditMinor: 0n },
        { orgId, entryId: entry.id, accountId: revenue.id, debitMinor: 0n, creditMinor: 10n },
      ]).returning({ id: journalLines.id });
    });

    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await tx.update(journalLines).set({ debitMinor: 999n }).where(eq(journalLines.id, lineId));
      });
    } catch (err) {
      code = sqlState(err);
    }
    // 42501 = insufficient_privilege.
    expect(code).toBe('42501');
  });
});

describe('reverseJournalEntry — the only correction mechanism', () => {
  it('produces a balanced entry with every line swapped', async () => {
    const original = await withOrgContext(testDb, orgId, (tx) => postJournalEntry(tx, {
      orgId,
      journalType: 'general',
      description: 'original entry',
      lines: [
        { accountCode: ACCOUNT_CODES.CASH, debitMinor: 1000n },
        { accountCode: ACCOUNT_CODES.SALES_REVENUE, creditMinor: 1000n },
      ],
    }));

    const reversal = await withOrgContext(testDb, orgId, (tx) =>
      reverseJournalEntry(tx, orgId, original.id, 'reversing the original'));

    const lines = await testDb.select({
      accountId: journalLines.accountId,
      debitMinor: journalLines.debitMinor,
      creditMinor: journalLines.creditMinor,
    }).from(journalLines).where(eq(journalLines.entryId, reversal.id));

    const [cash] = await testDb.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.code, ACCOUNT_CODES.CASH))).limit(1);

    const cashLine = lines.find((l) => l.accountId === cash.id);
    // The original debited cash 1000; the reversal must credit it 1000.
    expect(cashLine?.creditMinor).toBe(1000n);
    expect(cashLine?.debitMinor).toBe(0n);

    const [entryRow] = await testDb.select({ reversalOf: journalEntries.reversalOf })
      .from(journalEntries).where(eq(journalEntries.id, reversal.id));
    expect(entryRow.reversalOf).toBe(original.id);
  });
});

describe('trial balance', () => {
  it('nets to zero across every account for an org after several entries', async () => {
    const org2 = (await testDb.insert(organizations)
      .values({ name: 'Trial Balance Org', slug: `tb-${Date.now()}` }).returning())[0];

    await withOrgContext(testDb, org2.id, async (tx) => {
      await postJournalEntry(tx, {
        orgId: org2.id, journalType: 'sales', description: 'sale 1',
        lines: [
          { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, debitMinor: 1140n },
          { accountCode: ACCOUNT_CODES.SALES_REVENUE, creditMinor: 1000n },
          { accountCode: ACCOUNT_CODES.VAT_PAYABLE, creditMinor: 140n },
        ],
      });
      await postJournalEntry(tx, {
        orgId: org2.id, journalType: 'purchases', description: 'goods received',
        lines: [
          { accountCode: ACCOUNT_CODES.INVENTORY, debitMinor: 500n },
          { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, creditMinor: 500n },
        ],
      });
      await postJournalEntry(tx, {
        orgId: org2.id, journalType: 'cash', description: 'cod remitted',
        lines: [
          { accountCode: ACCOUNT_CODES.BANK, debitMinor: 1140n },
          { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, creditMinor: 1140n },
        ],
      });
    });

    const totalsRows = await testDb.execute<{ debit: string; credit: string }>(sql`
      SELECT COALESCE(SUM(debit_minor), 0)::text AS debit, COALESCE(SUM(credit_minor), 0)::text AS credit
      FROM journal_lines WHERE org_id = ${org2.id}
    `);
    const [totals] = [...totalsRows];
    expect(BigInt(totals.debit)).toBe(BigInt(totals.credit));
  });
});
