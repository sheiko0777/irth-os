/**
 * The double-entry ledger against real Postgres — proving what a mock cannot.
 *
 * Guarantee 1 (postJournalEntry's pure pre-SQL check) is unit-tested in
 * packages/db/src/__tests__/ledger.test.ts. This file proves guarantee 2: the
 * DEFERRABLE CONSTRAINT TRIGGER on journal_lines rejects an unbalanced entry
 * regardless of what wrote it — including a raw INSERT that bypasses
 * postJournalEntry entirely, which is exactly the scenario the trigger exists
 * for. A constraint nobody has seen fail is not known to work.
 *
 * Since 0080 (ledger v2) the trigger sums FUNCTIONAL amounts, every line
 * belongs to its entry's and its account's legal entity (composite FKs), and
 * one source event posts once per kind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  accounts,
  fiscalPeriods,
  journalEntries,
  journalLines,
  legalEntities,
  organizations,
  postJournalEntry,
  resolveLedgerEntity,
  reverseJournalEntry,
  withOrgContext,
  ACCOUNT_CODES,
  ClosedPeriodError,
  ensureChartOfAccounts,
  type DbTx,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgId: string;
let entityId: string;
let brandId: string;
let channelId: string;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Ledger Org', slug: `ledger-${Date.now()}` }).returning();
  orgId = org.id;
  const entity = await withOrgContext(testDb, orgId, (tx) => resolveLedgerEntity(tx, orgId));
  entityId = entity.legalEntityId;
  brandId = entity.brandId!;
  channelId = entity.channelId!;
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

type Tx = DbTx;

async function accountId(tx: Pick<DbTx, 'select'>, code: string, legalEntityId = entityId): Promise<string> {
  const [row] = await tx.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.legalEntityId, legalEntityId), eq(accounts.code, code))).limit(1);
  return row.id;
}

/** A raw entry header, bypassing postJournalEntry. */
async function rawEntry(tx: Tx, description: string, legalEntityId = entityId): Promise<string> {
  const [entry] = await tx.insert(journalEntries).values({
    orgId, legalEntityId, entryKind: 'manual', journalType: 'general', description,
  }).returning({ id: journalEntries.id });
  return entry.id;
}

/** A raw EGP line whose functional amounts equal its transaction amounts (fx 1/1). */
function egpLine(entryId: string, accId: string, debitMinor: bigint, creditMinor: bigint) {
  return {
    orgId, legalEntityId: entityId, entryId, accountId: accId, debitMinor, creditMinor,
    functionalCurrency: 'EGP', functionalDebitMinor: debitMinor, functionalCreditMinor: creditMinor,
    fxRateNum: 1n, fxRateDen: 1n,
  };
}

describe('guarantee 2 — the deferred constraint trigger', () => {
  it('rejects a raw unbalanced insert at COMMIT, bypassing postJournalEntry entirely', async () => {
    // This is the scenario the trigger exists for: not "did our own function
    // make a mistake" (guarantee 1 already covers that) but "does the
    // database refuse an unbalanced entry no matter what wrote it."
    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await ensureChartOfAccounts(tx, orgId, entityId);
        const cash = await accountId(tx, ACCOUNT_CODES.CASH);
        const revenue = await accountId(tx, ACCOUNT_CODES.SALES_REVENUE);
        const entryId = await rawEntry(tx, 'deliberately unbalanced');

        // 100 debited, only 99 credited — the trigger must catch this even
        // though every individual row satisfies journal_lines_side_check
        // (each row is still exactly one side, just the totals disagree).
        await tx.insert(journalLines).values([
          egpLine(entryId, cash, 100n, 0n),
          egpLine(entryId, revenue, 0n, 99n),
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
      await ensureChartOfAccounts(tx, orgId, entityId);
      const cash = await accountId(tx, ACCOUNT_CODES.CASH);
      const revenue = await accountId(tx, ACCOUNT_CODES.SALES_REVENUE);
      const entryId = await rawEntry(tx, 'balanced raw insert');

      return tx.insert(journalLines).values([
        egpLine(entryId, cash, 500n, 0n),
        egpLine(entryId, revenue, 0n, 500n),
      ]).returning({ id: journalLines.id });
    });
    expect(rows).toHaveLength(2);
  });

  it('rejects a line that is both debit and credit at once (journal_lines_side_check)', async () => {
    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await ensureChartOfAccounts(tx, orgId, entityId);
        const cash = await accountId(tx, ACCOUNT_CODES.CASH);
        const entryId = await rawEntry(tx, 'both sides');
        await tx.insert(journalLines).values([egpLine(entryId, cash, 100n, 100n)]);
      });
    } catch (err) {
      code = sqlState(err);
    }
    expect(code).toBe('23514');
  });

  it('rejects at COMMIT a raw entry balanced in transaction currency but not in functional currency', async () => {
    // EUR 10.00 debit / EUR 10.00 credit balances in EUR — but the rows claim
    // functional 500.00 vs 499.99 EGP. The trigger sums functional, so it refuses.
    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await ensureChartOfAccounts(tx, orgId, entityId);
        const bank = await accountId(tx, ACCOUNT_CODES.BANK);
        const cash = await accountId(tx, ACCOUNT_CODES.CASH);
        const entryId = await rawEntry(tx, 'txn-balanced, functional-unbalanced');
        await tx.insert(journalLines).values([
          { ...egpLine(entryId, bank, 1000n, 0n), currency: 'EUR', functionalDebitMinor: 50000n, fxRateNum: 50n },
          { ...egpLine(entryId, cash, 0n, 1000n), currency: 'EUR', functionalCreditMinor: 49999n, fxRateNum: 49999n, fxRateDen: 1000n },
        ]);
      });
    } catch (err) {
      code = sqlState(err);
    }
    expect(code).toBe('23514');
  });

  it('commits a mixed-currency entry that balances in functional currency', async () => {
    // 1 EUR = 50 EGP: EUR 10.00 into the bank, EGP 500.00 out of the till.
    const entry = await withOrgContext(testDb, orgId, (tx) => postJournalEntry(tx, {
      orgId, entryKind: 'manual', journalType: 'cash', description: 'EUR bought with EGP',
      lines: [
        { accountCode: ACCOUNT_CODES.BANK, currency: 'EUR', debitMinor: 1000n, fxRateNum: 50n, fxRateDen: 1n },
        { accountCode: ACCOUNT_CODES.CASH, currency: 'EGP', creditMinor: 50000n },
      ],
    }));
    const lines = await testDb.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
    expect(lines).toHaveLength(2);
    const eur = lines.find((l) => l.currency === 'EUR')!;
    expect(eur.functionalCurrency).toBe('EGP');
    expect(eur.functionalDebitMinor).toBe(50000n);
    expect(eur.legalEntityId).toBe(entityId);
  });
});

describe('entity boundaries and once-per-source', () => {
  it('rejects a line whose account belongs to another entity than its entry (composite FK)', async () => {
    const [entityB] = await withOrgContext(testDb, orgId, (tx) => tx.insert(legalEntities).values({
      orgId, code: `B${Date.now()}`, name: 'Entity B', documentPrefix: 'EB',
    }).returning({ id: legalEntities.id }));

    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, async (tx) => {
        await ensureChartOfAccounts(tx, orgId, entityId);
        await ensureChartOfAccounts(tx, orgId, entityB.id);
        const cashA = await accountId(tx, ACCOUNT_CODES.CASH);
        const revenueB = await accountId(tx, ACCOUNT_CODES.SALES_REVENUE, entityB.id);
        const entryId = await rawEntry(tx, 'cross-entity line'); // entity A
        await tx.insert(journalLines).values([
          egpLine(entryId, cashA, 100n, 0n),
          // Claims entity A (so the entry FK holds) but points at B's account.
          egpLine(entryId, revenueB, 0n, 100n),
        ]);
      });
    } catch (err) {
      code = sqlState(err);
    }
    // foreign_key_violation on journal_lines_account_entity_fkey.
    expect(code).toBe('23503');
  });

  it('rejects posting the same (source, kind) twice', async () => {
    const sourceId = crypto.randomUUID();
    const post = (tx: Tx) => postJournalEntry(tx, {
      orgId, entryKind: 'courier_remittance', journalType: 'cash', description: 'COD remitted',
      sourceTable: 'courier_remittances', sourceId,
      lines: [
        { accountCode: ACCOUNT_CODES.BANK, currency: 'EGP', debitMinor: 700n },
        { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, currency: 'EGP', creditMinor: 700n },
      ],
    });
    await withOrgContext(testDb, orgId, post);

    let code: string | undefined;
    try {
      await withOrgContext(testDb, orgId, post);
    } catch (err) {
      code = sqlState(err);
    }
    // unique_violation on journal_entries_source_kind_once.
    expect(code).toBe('23505');
  });

  it('closes a fiscal period per entity: a closed period on another entity does not block this one', async () => {
    const [entityC] = await withOrgContext(testDb, orgId, (tx) => tx.insert(legalEntities).values({
      orgId, code: `C${Date.now()}`, name: 'Entity C', documentPrefix: 'EC',
    }).returning({ id: legalEntities.id }));
    const day = new Date('2025-03-15T12:00:00Z');
    await withOrgContext(testDb, orgId, (tx) => tx.insert(fiscalPeriods).values({
      orgId, legalEntityId: entityC.id, startDate: new Date('2025-03-01'), endDate: new Date('2025-03-31'), status: 'closed',
    }));
    const lines = [
      { accountCode: ACCOUNT_CODES.BANK, currency: 'EGP', debitMinor: 100n },
      { accountCode: ACCOUNT_CODES.CASH, currency: 'EGP', creditMinor: 100n },
    ];

    await expect(withOrgContext(testDb, orgId, (tx) => postJournalEntry(tx, {
      orgId, legalEntityId: entityC.id, entryKind: 'manual', journalType: 'cash', description: 'into a closed period',
      entryDate: day, lines,
    }))).rejects.toBeInstanceOf(ClosedPeriodError);

    const ok = await withOrgContext(testDb, orgId, (tx) => postJournalEntry(tx, {
      orgId, entryKind: 'manual', journalType: 'cash', description: 'default entity, same day', entryDate: day, lines,
    }));
    expect(ok.id).toBeTruthy();
  });
});

describe('guarantee 3 — journal_entries and journal_lines are insert-only', () => {
  it('refuses UPDATE on journal_lines for the app role', async () => {
    const [{ id: lineId }] = await withOrgContext(testDb, orgId, async (tx) => {
      await ensureChartOfAccounts(tx, orgId, entityId);
      const cash = await accountId(tx, ACCOUNT_CODES.CASH);
      const revenue = await accountId(tx, ACCOUNT_CODES.SALES_REVENUE);
      const entryId = await rawEntry(tx, 'immutability check');
      return tx.insert(journalLines).values([
        egpLine(entryId, cash, 10n, 0n),
        egpLine(entryId, revenue, 0n, 10n),
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
      entryKind: 'manual',
      journalType: 'general',
      description: 'original entry',
      dimensions: { brandId, channelId },
      lines: [
        { accountCode: ACCOUNT_CODES.CASH, currency: "EGP", debitMinor: 1000n },
        { accountCode: ACCOUNT_CODES.SALES_REVENUE, currency: "EGP", creditMinor: 1000n },
      ],
    }));

    const reversal = await withOrgContext(testDb, orgId, (tx) =>
      reverseJournalEntry(tx, orgId, original.id, 'reversing the original'));

    const lines = await testDb.select({
      accountId: journalLines.accountId,
      debitMinor: journalLines.debitMinor,
      creditMinor: journalLines.creditMinor,
    }).from(journalLines).where(eq(journalLines.entryId, reversal.id));

    const cash = await accountId(testDb, ACCOUNT_CODES.CASH);

    const cashLine = lines.find((l) => l.accountId === cash);
    // The original debited cash 1000; the reversal must credit it 1000.
    expect(cashLine?.creditMinor).toBe(1000n);
    expect(cashLine?.debitMinor).toBe(0n);

    const [entryRow] = await testDb.select({ reversalOf: journalEntries.reversalOf, entryKind: journalEntries.entryKind })
      .from(journalEntries).where(eq(journalEntries.id, reversal.id));
    expect(entryRow.reversalOf).toBe(original.id);
    expect(entryRow.entryKind).toBe('reversal');
  });

  it('reverses functional and transaction amounts at the original rate, and keeps the dimensions', async () => {
    const orderId = crypto.randomUUID();
    const original = await withOrgContext(testDb, orgId, (tx) => postJournalEntry(tx, {
      orgId, entryKind: 'manual', journalType: 'sales', description: 'EUR sale',
      dimensions: { brandId, channelId, orderId },
      lines: [
        { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_ONLINE, currency: 'EUR', debitMinor: 1999n, fxRateNum: 5123n, fxRateDen: 100n },
        { accountCode: ACCOUNT_CODES.SALES_REVENUE, currency: 'EUR', creditMinor: 1999n, fxRateNum: 5123n, fxRateDen: 100n },
      ],
    }));
    const reversal = await withOrgContext(testDb, orgId, (tx) => reverseJournalEntry(tx, orgId, original.id, 'undo EUR sale'));

    const load = (entryId: string) => testDb.select({
      accountId: journalLines.accountId, currency: journalLines.currency,
      debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor,
      functionalDebitMinor: journalLines.functionalDebitMinor, functionalCreditMinor: journalLines.functionalCreditMinor,
      fxRateNum: journalLines.fxRateNum, fxRateDen: journalLines.fxRateDen,
      brandId: journalLines.brandId, channelId: journalLines.channelId, orderId: journalLines.orderId,
      legalEntityId: journalLines.legalEntityId,
    }).from(journalLines).where(eq(journalLines.entryId, entryId));
    const before = await load(original.id);
    const after = await load(reversal.id);
    expect(after).toHaveLength(before.length);

    for (const o of before) {
      const r = after.find((l) => l.accountId === o.accountId)!;
      expect(r.debitMinor).toBe(o.creditMinor);
      expect(r.creditMinor).toBe(o.debitMinor);
      expect(r.functionalDebitMinor).toBe(o.functionalCreditMinor);
      expect(r.functionalCreditMinor).toBe(o.functionalDebitMinor);
      expect([r.currency, r.fxRateNum, r.fxRateDen]).toEqual([o.currency, o.fxRateNum, o.fxRateDen]);
      expect([r.brandId, r.channelId, r.orderId, r.legalEntityId]).toEqual([brandId, channelId, orderId, entityId]);
    }
  });
});

describe('trial balance', () => {
  it('nets to zero across every account for an org after several entries', async () => {
    const org2 = (await testDb.insert(organizations)
      .values({ name: 'Trial Balance Org', slug: `tb-${Date.now()}` }).returning())[0];

    await withOrgContext(testDb, org2.id, async (tx) => {
      await postJournalEntry(tx, {
        orgId: org2.id, entryKind: 'manual', journalType: 'sales', description: 'sale 1', defaultChannel: true,
        lines: [
          { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, currency: "EGP", debitMinor: 1140n },
          { accountCode: ACCOUNT_CODES.SALES_REVENUE, currency: "EGP", creditMinor: 1000n },
          { accountCode: ACCOUNT_CODES.VAT_PAYABLE, currency: "EGP", creditMinor: 140n },
        ],
      });
      await postJournalEntry(tx, {
        orgId: org2.id, entryKind: 'manual', journalType: 'purchases', description: 'goods received',
        lines: [
          { accountCode: ACCOUNT_CODES.INVENTORY, currency: "EGP", debitMinor: 500n },
          { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, currency: "EGP", creditMinor: 500n },
        ],
      });
      await postJournalEntry(tx, {
        orgId: org2.id, entryKind: 'manual', journalType: 'cash', description: 'cod remitted',
        lines: [
          { accountCode: ACCOUNT_CODES.BANK, currency: "EGP", debitMinor: 1140n },
          { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, currency: "EGP", creditMinor: 1140n },
        ],
      });
    });

    const totalsRows = await testDb.execute<{ debit: string; credit: string; fdebit: string; fcredit: string }>(sql`
      SELECT COALESCE(SUM(debit_minor), 0)::text AS debit, COALESCE(SUM(credit_minor), 0)::text AS credit,
             COALESCE(SUM(functional_debit_minor), 0)::text AS fdebit, COALESCE(SUM(functional_credit_minor), 0)::text AS fcredit
      FROM journal_lines WHERE org_id = ${org2.id}
    `);
    const [totals] = [...totalsRows];
    expect(BigInt(totals.debit)).toBe(BigInt(totals.credit));
    expect(BigInt(totals.fdebit)).toBe(BigInt(totals.fcredit));
  });
});
