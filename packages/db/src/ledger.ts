import { and, eq, inArray, lte, gte } from 'drizzle-orm';
import { accounts, journalEntries, journalLines, fiscalPeriods } from './schema/ledger';
import type { DbTx } from './index';
import { assertSupportedCurrency, convert, currency as toCurrency, fromMinor } from '@irth/domain';
import { lookupRate } from './fx';
import { resolveLedgerEntity } from './ledgerEntity';

/** Raised by `postJournalEntry` before any INSERT runs — guarantee 1 of 3, see 0038. */
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

/** A revenue/COGS line posted without the analytic dimensions REQUIRED_DIMENSIONS demands. */
export class RequiredDimensionError extends Error {
  constructor(readonly accountCode: string, readonly missing: readonly string[]) {
    super(`Journal line for ${accountCode} is missing required dimension(s): ${missing.join(', ')}`);
    this.name = 'RequiredDimensionError';
  }
}

export type LedgerJournalType = 'sales' | 'purchases' | 'cash' | 'inventory' | 'general';
export type LedgerEntryKind = (typeof journalEntries.$inferInsert)['entryKind'];
export type LedgerCounterpartyKind = NonNullable<(typeof journalLines.$inferInsert)['counterpartyKind']>;

/**
 * The standard Egyptian-flavoured chart of accounts every legal entity is
 * seeded with. See migration 0038 for why this is a fixed set rather than a
 * global table or a per-org customisation UI — nothing in this codebase needs
 * either yet. Since 0080 it is seeded per legal entity.
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
  // Holds money captured online (e.g. Paymob) before an actual bank settlement.
  { code: '1050', name: 'ذمم مدينة - دفع إلكتروني', type: 'asset', normalBalance: 'debit' },
  // Cash a delivery rep has collected and not yet handed over (0077): it
  // leaves AR-COD when collected and reaches 1010 when the cashier counts it.
  { code: '1060', name: 'عهدة المناديب', type: 'asset', normalBalance: 'debit' },
  // 0080 (DM-03): intercompany and clearing accounts.
  { code: '1070', name: 'ذمم مدينة - شركات شقيقة', type: 'asset', normalBalance: 'debit' },
  { code: '1080', name: 'حساب وسيط بوابات الدفع', type: 'asset', normalBalance: 'debit' },
  // One account for every courier; the courier is named in the line memo /
  // counterparty, not by a per-courier account.
  { code: '1090', name: 'حساب وسيط تحصيل شركات الشحن', type: 'asset', normalBalance: 'debit' },
  { code: '2010', name: 'ذمم دائنة - موردون', type: 'liability', normalBalance: 'credit' },
  { code: '2020', name: 'التزامات بطاقات الهدايا', type: 'liability', normalBalance: 'credit' },
  { code: '2030', name: 'ضريبة القيمة المضافة مستحقة', type: 'liability', normalBalance: 'credit' },
  { code: '2040', name: 'مبالغ مستردة مستحقة للعملاء', type: 'liability', normalBalance: 'credit' },
  { code: '2050', name: 'ذمم دائنة - شركات شقيقة', type: 'liability', normalBalance: 'credit' },
  { code: '3010', name: 'الأرباح المحتجزة', type: 'equity', normalBalance: 'credit' },
  { code: '4010', name: 'إيرادات المبيعات', type: 'revenue', normalBalance: 'credit' },
  // Contra-revenue: type=revenue (belongs in that section of a report) but
  // normal_balance=debit (a return reduces revenue, so its entries are debits).
  { code: '4020', name: 'مرتجعات ومسموحات المبيعات', type: 'revenue', normalBalance: 'debit' },
  { code: '4030', name: 'إيرادات مبيعات بين الشركات الشقيقة', type: 'revenue', normalBalance: 'credit' },
  { code: '5010', name: 'تكلفة البضاعة المباعة', type: 'expense', normalBalance: 'debit' },
  // Posted to on either side — a shortage debits it (loss), an overage
  // credits it (gain). An expense account occasionally credited to record a
  // gain is standard practice, not a modelling error.
  { code: '5020', name: 'فروق جرد المخزون', type: 'expense', normalBalance: 'debit' },
  // A rep handover short of what they collected, written off by a separate,
  // approved entry — never by editing the handover's own posting.
  { code: '5030', name: 'عجز عهدة المناديب', type: 'expense', normalBalance: 'debit' },
  { code: '5040', name: 'تكلفة مبيعات بين الشركات الشقيقة', type: 'expense', normalBalance: 'debit' },
  // Both sides, like 5020: FX losses debit it, gains credit it. Also absorbs
  // the rounding residue of converting a balanced foreign-currency entry.
  { code: '5050', name: 'أرباح وخسائر فروق العملة', type: 'expense', normalBalance: 'debit' },
] as const;

export const ACCOUNT_CODES = {
  CASH: '1010',
  BANK: '1020',
  ACCOUNTS_RECEIVABLE_COD: '1030',
  INVENTORY: '1040',
  ACCOUNTS_RECEIVABLE_ONLINE: '1050',
  REP_CUSTODY: '1060',
  INTERCOMPANY_RECEIVABLE: '1070',
  GATEWAY_CLEARING: '1080',
  COURIER_COD_CLEARING: '1090',
  ACCOUNTS_PAYABLE: '2010',
  GIFT_CARD_LIABILITY: '2020',
  VAT_PAYABLE: '2030',
  CUSTOMER_REFUNDS_PAYABLE: '2040',
  INTERCOMPANY_PAYABLE: '2050',
  RETAINED_EARNINGS: '3010',
  SALES_REVENUE: '4010',
  SALES_RETURNS: '4020',
  INTERCOMPANY_REVENUE: '4030',
  COGS: '5010',
  INVENTORY_VARIANCE: '5020',
  REP_CUSTODY_SHORTAGE: '5030',
  INTERCOMPANY_COGS: '5040',
  FX_GAIN_LOSS: '5050',
} as const;

export interface LineDimensions {
  brandId?: string | null;
  channelId?: string | null;
  warehouseId?: string | null;
  variantId?: string | null;
  orderId?: string | null;
  counterpartyKind?: LedgerCounterpartyKind | null;
  counterpartyId?: string | null;
}

type DimensionKey = keyof LineDimensions;

/**
 * Dimensions a line on these accounts must carry. Revenue and COGS are what
 * brand / channel profitability is computed from; a line without them would
 * silently fall out of every per-brand report.
 */
export const REQUIRED_DIMENSIONS: Readonly<Record<string, readonly DimensionKey[]>> = {
  [ACCOUNT_CODES.SALES_REVENUE]: ['brandId', 'channelId'],
  [ACCOUNT_CODES.SALES_RETURNS]: ['brandId', 'channelId'],
  [ACCOUNT_CODES.INTERCOMPANY_REVENUE]: ['brandId', 'channelId'],
  [ACCOUNT_CODES.COGS]: ['brandId', 'channelId'],
  [ACCOUNT_CODES.INTERCOMPANY_COGS]: ['brandId', 'channelId'],
};

/**
 * Idempotent: `ON CONFLICT DO NOTHING` keyed on (org_id, legal_entity_id,
 * code), matching `nextDocumentNumber`'s auto-provisioning style. No separate
 * "create entity" hook has to remember to seed a chart of accounts —
 * `postJournalEntry` calls this before every post, so the first entry an
 * entity ever posts silently provisions its accounts as a side effect.
 */
export async function ensureChartOfAccounts(tx: Pick<DbTx, 'insert'>, orgId: string, legalEntityId: string): Promise<void> {
  await tx
    .insert(accounts)
    .values(STANDARD_ACCOUNTS.map((a) => ({ orgId, legalEntityId, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance })))
    .onConflictDoNothing();
}

export interface JournalLineInput extends LineDimensions {
  accountCode: string;
  currency: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
  memo?: string;
  /**
   * The rate to the entity's functional currency (1 `currency` =
   * fxRateNum/fxRateDen functional). Omitted: identity when `currency` is the
   * functional currency, else the org's exchange_rates (lookupRate) as of the
   * entry date. Both or neither.
   */
  fxRateNum?: bigint;
  fxRateDen?: bigint;
  /** The functional amount, when the caller already knows it exactly (reversals). Needs fxRateNum/Den. */
  functionalMinor?: bigint;
}

export interface PostJournalEntryInput {
  orgId: string;
  /** Omitted: the org's default legal entity (organizations.stock_owner_entity_id). */
  legalEntityId?: string;
  entryKind: LedgerEntryKind;
  journalType: LedgerJournalType;
  description: string;
  entryDate?: Date;
  sourceTable?: string;
  sourceId?: string;
  createdBy?: string | null;
  reversalOf?: string;
  /** Applied to every line that does not set the dimension itself. */
  dimensions?: LineDimensions;
  /**
   * Fill brand/channel/warehouse on lines that lack them from the entity's
   * default selling channel. For callers with no channel of their own to
   * name (orders carry no channel yet). Without it, a revenue/COGS line
   * lacking brand+channel is refused before any SQL.
   */
  defaultChannel?: boolean;
  lines: JournalLineInput[];
}

const DIMENSION_KEYS: readonly DimensionKey[] = ['brandId', 'channelId', 'warehouseId', 'variantId', 'orderId', 'counterpartyKind', 'counterpartyId'];

function mergeDimensions(line: JournalLineInput, header: LineDimensions | undefined, fallback: LineDimensions | undefined): Required<LineDimensions> {
  const out = {} as Record<DimensionKey, unknown>;
  for (const key of DIMENSION_KEYS) {
    out[key] = line[key] ?? header?.[key] ?? fallback?.[key] ?? null;
  }
  return out as Required<LineDimensions>;
}

function missingDimensions(code: string, dims: Required<LineDimensions>): string[] {
  return (REQUIRED_DIMENSIONS[code] ?? []).filter((key) => dims[key] == null);
}

/**
 * Posts one journal entry, balanced in the entity's functional currency.
 * Guarantee 1 of 3 (see 0038/0080): every shape check, the single-currency
 * balance check and the required-dimension check are pure and run before any
 * SQL; the functional balance check runs before any INSERT. The DEFERRABLE
 * CONSTRAINT TRIGGER on journal_lines (guarantee 2) re-derives the functional
 * sum from the rows Postgres holds and is what actually holds regardless of
 * this function.
 *
 * Mixed-currency entries are legal: each line is converted to the functional
 * currency (caller-supplied rate, else lookupRate) and the functional amounts
 * must balance. When every currency's own lines already balance, a converted
 * residue can only be rounding, and is posted to 5050 FX gain/loss.
 *
 * MUST be called with a transaction handle already scoped to `input.orgId`
 * (i.e. inside `ctx.withOrg` / `withOrgContext`) — this function does not open
 * its own transaction; the caller's transaction IS this function's
 * transaction, so guarantee 2 sees the entry and the caller's own writes as
 * one unit.
 */
export async function postJournalEntry(
  tx: Pick<DbTx, 'select' | 'insert' | 'rollback'>,
  input: PostJournalEntryInput,
): Promise<{ id: string }> {
  if (input.lines.length === 0) {
    throw new LedgerImbalanceError(0n, 0n);
  }

  // Guarantee 1, pure part. Same invariant as `@irth/domain`'s `isBalanced`.
  const txnByCurrency = new Map<string, { debit: bigint; credit: bigint }>();
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
    if ((line.fxRateNum === undefined) !== (line.fxRateDen === undefined)) {
      throw new RangeError(`Journal line for ${line.accountCode} must give both fxRateNum and fxRateDen, or neither.`);
    }
    if (line.fxRateNum !== undefined && (line.fxRateNum <= 0n || line.fxRateDen! <= 0n)) {
      throw new RangeError(`Journal line for ${line.accountCode} has a non-positive exchange rate.`);
    }
    if (line.functionalMinor !== undefined && (line.fxRateNum === undefined || line.functionalMinor <= 0n)) {
      throw new RangeError(`Journal line for ${line.accountCode}: functionalMinor must be positive and come with its fxRateNum/fxRateDen.`);
    }
    const sums = txnByCurrency.get(line.currency) ?? { debit: 0n, credit: 0n };
    sums.debit += d;
    sums.credit += c;
    txnByCurrency.set(line.currency, sums);
  }
  // One transaction currency: the txn amounts must balance on their own,
  // exactly as before 0080. Mixed currencies can only be judged in functional
  // currency, below.
  if (txnByCurrency.size === 1) {
    const [only] = txnByCurrency.values();
    if (only.debit !== only.credit) {
      throw new LedgerImbalanceError(only.debit, only.credit);
    }
  }
  for (const code of txnByCurrency.keys()) assertSupportedCurrency(code);

  if (!input.defaultChannel) {
    for (const line of input.lines) {
      const missing = missingDimensions(line.accountCode, mergeDimensions(line, input.dimensions, undefined));
      if (missing.length > 0) throw new RequiredDimensionError(line.accountCode, missing);
    }
  }

  const entryDate = input.entryDate ?? new Date();
  const entity = await resolveLedgerEntity(tx, input.orgId, input.legalEntityId);
  const functional = assertSupportedCurrency(entity.functionalCurrency);
  const fallback: LineDimensions | undefined = input.defaultChannel
    ? { brandId: entity.brandId, channelId: entity.channelId, warehouseId: entity.warehouseId }
    : undefined;

  const resolved = input.lines.map((line) => {
    const dims = mergeDimensions(line, input.dimensions, fallback);
    const missing = missingDimensions(line.accountCode, dims);
    if (missing.length > 0) throw new RequiredDimensionError(line.accountCode, missing);
    return { line, dims };
  });

  // Fail-open on absence, fail-closed on an explicit close — see 0038's
  // comment on fiscal_periods. Per entity since 0080.
  const [closed] = await tx
    .select({ id: fiscalPeriods.id })
    .from(fiscalPeriods)
    .where(and(
      eq(fiscalPeriods.orgId, input.orgId),
      eq(fiscalPeriods.legalEntityId, entity.legalEntityId),
      eq(fiscalPeriods.status, 'closed'),
      lte(fiscalPeriods.startDate, entryDate),
      gte(fiscalPeriods.endDate, entryDate),
    ))
    .limit(1);
  if (closed) {
    throw new ClosedPeriodError(entryDate);
  }

  // Functional amounts. One rate per currency per entry.
  const asOf = entryDate.toISOString().slice(0, 10);
  const looked = new Map<string, { num: bigint; den: bigint }>();
  const rows = [];
  for (const { line, dims } of resolved) {
    const txnCurrency = toCurrency(line.currency);
    let rate: { num: bigint; den: bigint };
    if (line.fxRateNum !== undefined) {
      rate = { num: line.fxRateNum, den: line.fxRateDen! };
    } else if (line.currency === functional) {
      rate = { num: 1n, den: 1n };
    } else {
      rate = looked.get(line.currency) ?? await lookupRate(tx, input.orgId, line.currency, functional, asOf);
      looked.set(line.currency, rate);
    }
    const txnMinor = (line.debitMinor ?? 0n) > 0n ? line.debitMinor! : line.creditMinor!;
    const functionalMinor = line.functionalMinor
      ?? convert(fromMinor(txnMinor, txnCurrency), { base: txnCurrency, quote: functional, num: rate.num, den: rate.den }).minor;
    if (functionalMinor <= 0n) {
      throw new RangeError(`Journal line for ${line.accountCode}: ${txnMinor} ${line.currency} converts to nothing in ${functional}.`);
    }
    const isDebit = (line.debitMinor ?? 0n) > 0n;
    rows.push({
      accountCode: line.accountCode,
      currency: txnCurrency as string,
      debitMinor: line.debitMinor ?? 0n,
      creditMinor: line.creditMinor ?? 0n,
      functionalDebitMinor: isDebit ? functionalMinor : 0n,
      functionalCreditMinor: isDebit ? 0n : functionalMinor,
      fxRateNum: rate.num,
      fxRateDen: rate.den,
      memo: line.memo ?? null,
      ...dims,
    });
  }

  // Guarantee 1, functional part — still before any INSERT.
  const fDebit = rows.reduce((acc, r) => acc + r.functionalDebitMinor, 0n);
  const fCredit = rows.reduce((acc, r) => acc + r.functionalCreditMinor, 0n);
  if (fDebit !== fCredit) {
    const everyCurrencyBalances = [...txnByCurrency.values()].every((s) => s.debit === s.credit);
    if (!everyCurrencyBalances) {
      throw new LedgerImbalanceError(fDebit, fCredit);
    }
    // Pure rounding residue of converting balanced foreign-currency lines.
    const residue = fDebit - fCredit;
    const amount = residue > 0n ? residue : -residue;
    rows.push({
      accountCode: ACCOUNT_CODES.FX_GAIN_LOSS,
      currency: functional as string,
      debitMinor: residue < 0n ? amount : 0n,
      creditMinor: residue > 0n ? amount : 0n,
      functionalDebitMinor: residue < 0n ? amount : 0n,
      functionalCreditMinor: residue > 0n ? amount : 0n,
      fxRateNum: 1n,
      fxRateDen: 1n,
      memo: 'FX rounding',
      ...mergeDimensions({ accountCode: ACCOUNT_CODES.FX_GAIN_LOSS, currency: functional }, input.dimensions, undefined),
    });
  }

  await ensureChartOfAccounts(tx, input.orgId, entity.legalEntityId);

  const codes = [...new Set(rows.map((r) => r.accountCode))];
  const accountRows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(and(
      eq(accounts.orgId, input.orgId),
      eq(accounts.legalEntityId, entity.legalEntityId),
      inArray(accounts.code, codes),
    ));

  const idByCode = new Map(accountRows.map((r) => [r.code, r.id]));
  const missing = codes.filter((c) => !idByCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Unknown ledger account code(s) for org ${input.orgId}: ${missing.join(', ')}`);
  }

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      orgId: input.orgId,
      legalEntityId: entity.legalEntityId,
      journalType: input.journalType,
      entryKind: input.entryKind,
      entryDate,
      description: input.description,
      sourceTable: input.sourceTable ?? null,
      sourceId: input.sourceId ?? null,
      reversalOf: input.reversalOf ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalLines).values(
    rows.map(({ accountCode, ...row }) => ({
      ...row,
      orgId: input.orgId,
      legalEntityId: entity.legalEntityId,
      entryId: entry.id,
      accountId: idByCode.get(accountCode)!,
      functionalCurrency: functional,
    })),
  );

  return { id: entry.id };
}

/**
 * Posts a reversing entry: every line of the original, debit and credit
 * swapped — transaction AND functional amounts, at the original rate, with the
 * original dimensions, in the original entity. This is the ONLY correction
 * mechanism — journal_entries and journal_lines carry no UPDATE/DELETE grant
 * for the app role (guarantee 3, 0038/0080), so a wrong entry is never edited
 * or removed, only offset by a new one that references it via `reversalOf`.
 */
export async function reverseJournalEntry(
  tx: Pick<DbTx, 'select' | 'insert' | 'rollback'>,
  orgId: string,
  entryId: string,
  description: string,
): Promise<{ id: string }> {
  const original = await tx
    .select({
      accountCode: accounts.code,
      currency: journalLines.currency,
      debitMinor: journalLines.debitMinor,
      creditMinor: journalLines.creditMinor,
      functionalDebitMinor: journalLines.functionalDebitMinor,
      functionalCreditMinor: journalLines.functionalCreditMinor,
      fxRateNum: journalLines.fxRateNum,
      fxRateDen: journalLines.fxRateDen,
      brandId: journalLines.brandId,
      channelId: journalLines.channelId,
      warehouseId: journalLines.warehouseId,
      variantId: journalLines.variantId,
      orderId: journalLines.orderId,
      counterpartyKind: journalLines.counterpartyKind,
      counterpartyId: journalLines.counterpartyId,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.orgId, orgId)));

  if (original.length === 0) {
    throw new Error(`Cannot reverse ${entryId}: no lines found (wrong org, or the entry does not exist).`);
  }

  const [origEntry] = await tx
    .select({ journalType: journalEntries.journalType, legalEntityId: journalEntries.legalEntityId })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)))
    .limit(1);

  return postJournalEntry(tx, {
    orgId,
    legalEntityId: origEntry?.legalEntityId,
    entryKind: 'reversal',
    journalType: origEntry?.journalType ?? 'general',
    description,
    sourceTable: 'journal_entries',
    sourceId: entryId,
    reversalOf: entryId,
    lines: original.map((l) => ({
      accountCode: l.accountCode,
      currency: l.currency,
      // Swapped: what was a debit becomes a credit and vice versa.
      debitMinor: l.creditMinor > 0n ? l.creditMinor : undefined,
      creditMinor: l.debitMinor > 0n ? l.debitMinor : undefined,
      functionalMinor: l.functionalDebitMinor > 0n ? l.functionalDebitMinor : l.functionalCreditMinor,
      fxRateNum: l.fxRateNum,
      fxRateDen: l.fxRateDen,
      brandId: l.brandId,
      channelId: l.channelId,
      warehouseId: l.warehouseId,
      variantId: l.variantId,
      orderId: l.orderId,
      counterpartyKind: l.counterpartyKind,
      counterpartyId: l.counterpartyId,
      memo: l.memo ?? undefined,
    })),
  });
}
