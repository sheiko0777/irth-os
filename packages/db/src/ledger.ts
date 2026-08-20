import { and, eq, inArray, lte, gte } from 'drizzle-orm';
import { accounts, journalEntries, journalLines, fiscalPeriods } from './schema/ledger';
import type { DbTx } from './index';

/** Raised by `postJournalEntry` before any SQL runs — guarantee 1 of 3, see 0038. */
export class LedgerImbalanceError extends Error {
  constructor(readonly debitMinor: bigint, readonly creditMinor: bigint) {
    super(`Journal entry does not balance: debit=${debitMinor} credit=${creditMinor}`);
    this.name = 'LedgerImbalanceError';
  }
}

export class ClosedPeriodError extends Error {
  constructor(entryDate: Date) {
    super(`Cannot post to ${entryDate.toISOString().slice(0, 10)}: the fiscal period covering it is closed.`);
    this.name = 'ClosedPeriodError';
  }
}

export type LedgerJournalType = 'sales' | 'purchases' | 'cash' | 'inventory' | 'general';

/**
 * The standard Egyptian-flavoured chart of accounts every org is seeded with.
 * See migration 0038 for why this is a fixed, org-scoped set rather than a
 * global table or a per-org customisation UI — nothing in this codebase needs
 * either yet.
 *
 * `normalBalance` is explicit per account (not derived from `type`) so a
 * contra account — 4020 lives in the revenue section but carries a debit
 * balance — is representable at all.
 */
export const STANDARD_ACCOUNTS = [
  { code: '1010', name: 'النقد في الصندوق', type: 'asset', normalBalance: 'debit' },
  { code: '1020', name: 'البنك', type: 'asset', normalBalance: 'debit' },
  { code: '1030', name: 'ذمم مدينة - تحصيل عند الاستلام', type: 'asset', normalBalance: 'debit' },
  { code: '1040', name: 'المخزون', type: 'asset', normalBalance: 'debit' },
  { code: '2010', name: 'ذمم دائنة - موردون', type: 'liability', normalBalance: 'credit' },
  { code: '2020', name: 'التزامات بطاقات الهدايا', type: 'liability', normalBalance: 'credit' },
  { code: '2030', name: 'ضريبة القيمة المضافة مستحقة', type: 'liability', normalBalance: 'credit' },
  { code: '2040', name: 'مبالغ مستردة مستحقة للعملاء', type: 'liability', normalBalance: 'credit' },
  { code: '3010', name: 'الأرباح المحتجزة', type: 'equity', normalBalance: 'credit' },
  { code: '4010', name: 'إيرادات المبيعات', type: 'revenue', normalBalance: 'credit' },
  // Contra-revenue: type=revenue (belongs in that section of a report) but
  // normal_balance=debit (a return reduces revenue, so its entries are debits).
  { code: '4020', name: 'مرتجعات ومسموحات المبيعات', type: 'revenue', normalBalance: 'debit' },
  { code: '5010', name: 'تكلفة البضاعة المباعة', type: 'expense', normalBalance: 'debit' },
  // Posted to on either side — a shortage debits it (loss), an overage
  // credits it (gain). An expense account occasionally credited to record a
  // gain is standard practice, not a modelling error.
  { code: '5020', name: 'فروق جرد المخزون', type: 'expense', normalBalance: 'debit' },
] as const;

export const ACCOUNT_CODES = {
  CASH: '1010',
  BANK: '1020',
  ACCOUNTS_RECEIVABLE_COD: '1030',
  INVENTORY: '1040',
  ACCOUNTS_PAYABLE: '2010',
  GIFT_CARD_LIABILITY: '2020',
  VAT_PAYABLE: '2030',
  CUSTOMER_REFUNDS_PAYABLE: '2040',
  RETAINED_EARNINGS: '3010',
  SALES_REVENUE: '4010',
  SALES_RETURNS: '4020',
  COGS: '5010',
  INVENTORY_VARIANCE: '5020',
} as const;

/**
 * Idempotent: `ON CONFLICT DO NOTHING` keyed on (org_id, code), matching
 * `nextDocumentNumber`'s and `emitOutboxEvent`'s auto-provisioning style. No
 * separate "create org" hook has to remember to seed a chart of accounts —
 * `postJournalEntry` calls this before every post, so the first entry an org
 * ever posts silently provisions its accounts as a side effect.
 */
export async function ensureChartOfAccounts(tx: Pick<DbTx, 'insert'>, orgId: string): Promise<void> {
  await tx
    .insert(accounts)
    .values(STANDARD_ACCOUNTS.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance })))
    .onConflictDoNothing();
}

export interface JournalLineInput {
  accountCode: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
  memo?: string;
}

export interface PostJournalEntryInput {
  orgId: string;
  journalType: LedgerJournalType;
  description: string;
  entryDate?: Date;
  sourceTable?: string;
  sourceId?: string;
  createdBy?: string | null;
  reversalOf?: string;
  lines: JournalLineInput[];
}

/**
 * Posts one balanced journal entry. Guarantee 1 of 3 (see 0038): sums debits
 * and credits in plain JS and throws `LedgerImbalanceError` before issuing a
 * single INSERT if they disagree — the DEFERRABLE CONSTRAINT TRIGGER on
 * journal_lines (guarantee 2) is what actually holds regardless of this
 * function; this is the one that catches a bug in the CALLER's arithmetic
 * immediately, with a stack trace pointing at the caller, instead of a
 * generic trigger failure at COMMIT naming a row id with no context.
 *
 * MUST be called with a transaction handle already scoped to `input.orgId`
 * (i.e. inside `ctx.withOrg` / `withOrgContext`) — this function does not open
 * its own transaction, so a caller supplying `ctx.db` directly would insert
 * outside RLS. It is not typed to refuse that the way `withAudit`/
 * `emitOutboxEvent` refuse a plain connection, because unlike those this
 * function's OWN multiple inserts (accounts seed + entry + lines) already need
 * to share one transaction with the caller's surrounding writes for `guarantee
 * 2` to see a consistent picture — so the caller's transaction IS this
 * function's transaction, by design, not an accident to type against.
 */
export async function postJournalEntry(
  tx: Pick<DbTx, 'select' | 'insert' | 'rollback'>,
  input: PostJournalEntryInput,
): Promise<{ id: string }> {
  if (input.lines.length === 0) {
    throw new LedgerImbalanceError(0n, 0n);
  }

  // The sum-and-compare below is the same one-line invariant as
  // `@irth/domain`'s `isBalanced` (packages/domain/src/money.ts), duplicated
  // rather than imported: packages/db has zero workspace dependencies today
  // and adding one needs `pnpm install`, which this refactor cannot run here
  // (10-30 minutes on this repo; a killed run has corrupted node_modules
  // before). `isBalanced` is the version property-tested with fast-check,
  // since fast-check itself is only resolvable from packages/domain under
  // this workspace's strict pnpm isolation.
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const line of input.lines) {
    const d = line.debitMinor ?? 0n;
    const c = line.creditMinor ?? 0n;
    if (d < 0n || c < 0n) {
      throw new RangeError(`Journal line for ${line.accountCode} has a negative amount (debit=${d}, credit=${c}).`);
    }
    if ((d > 0n) === (c > 0n)) {
      // Both zero, or both nonzero — a line must be exactly one side.
      throw new RangeError(`Journal line for ${line.accountCode} must have exactly one of debit/credit set (debit=${d}, credit=${c}).`);
    }
    debitTotal += d;
    creditTotal += c;
  }
  if (debitTotal !== creditTotal) {
    throw new LedgerImbalanceError(debitTotal, creditTotal);
  }

  const entryDate = input.entryDate ?? new Date();

  // Fail-open on absence, fail-closed on an explicit close — see 0038's
  // comment on fiscal_periods. No period-close UI exists yet, so most orgs
  // will have no period rows at all, and every post proceeds normally.
  const [closed] = await tx
    .select({ id: fiscalPeriods.id })
    .from(fiscalPeriods)
    .where(and(
      eq(fiscalPeriods.orgId, input.orgId),
      eq(fiscalPeriods.status, 'closed'),
      lte(fiscalPeriods.startDate, entryDate),
      gte(fiscalPeriods.endDate, entryDate),
    ))
    .limit(1);
  if (closed) {
    throw new ClosedPeriodError(entryDate);
  }

  await ensureChartOfAccounts(tx, input.orgId);

  const codes = [...new Set(input.lines.map((l) => l.accountCode))];
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.orgId, input.orgId), inArray(accounts.code, codes)));

  const idByCode = new Map(rows.map((r) => [r.code, r.id]));
  const missing = codes.filter((c) => !idByCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Unknown ledger account code(s) for org ${input.orgId}: ${missing.join(', ')}`);
  }

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      orgId: input.orgId,
      journalType: input.journalType,
      entryDate,
      description: input.description,
      sourceTable: input.sourceTable ?? null,
      sourceId: input.sourceId ?? null,
      reversalOf: input.reversalOf ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalLines).values(
    input.lines.map((line) => ({
      orgId: input.orgId,
      entryId: entry.id,
      accountId: idByCode.get(line.accountCode)!,
      debitMinor: line.debitMinor ?? 0n,
      creditMinor: line.creditMinor ?? 0n,
      memo: line.memo ?? null,
    })),
  );

  return { id: entry.id };
}

/**
 * Posts a reversing entry: every line of the original, debit and credit
 * swapped. This is the ONLY correction mechanism — journal_entries and
 * journal_lines carry no UPDATE/DELETE grant for the app role (guarantee 3,
 * 0038), so a wrong entry is never edited or removed, only offset by a new one
 * that references it via `reversalOf`.
 */
export async function reverseJournalEntry(
  tx: Pick<DbTx, 'select' | 'insert' | 'rollback'>,
  orgId: string,
  entryId: string,
  description: string,
): Promise<{ id: string }> {
  const original = await tx
    .select({ accountCode: accounts.code, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor, memo: journalLines.memo })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.orgId, orgId)));

  if (original.length === 0) {
    throw new Error(`Cannot reverse ${entryId}: no lines found (wrong org, or the entry does not exist).`);
  }

  const [origEntry] = await tx
    .select({ journalType: journalEntries.journalType })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)))
    .limit(1);

  return postJournalEntry(tx, {
    orgId,
    journalType: origEntry?.journalType ?? 'general',
    description,
    sourceTable: 'journal_entries',
    sourceId: entryId,
    reversalOf: entryId,
    lines: original.map((l) => ({
      accountCode: l.accountCode,
      // Swapped: what was a debit becomes a credit and vice versa.
      debitMinor: l.creditMinor > 0n ? l.creditMinor : undefined,
      creditMinor: l.debitMinor > 0n ? l.debitMinor : undefined,
      memo: l.memo ?? undefined,
    })),
  });
}
