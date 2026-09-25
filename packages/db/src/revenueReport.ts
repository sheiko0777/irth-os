import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalLines } from './schema/ledger';
import { ACCOUNT_CODES } from './ledger';
import type { DbTx } from './index';

/**
 * Sales figures for reports, read from the ledger — CLAUDE.md rule 2.
 *
 * Every dashboard, analytics and AI "revenue" number used to be
 * SUM(orders.total_amount_minor) over delivered orders. That is a record of
 * intent, not of value: it never subtracted a refund, it counted a delivered
 * order whether or not its sale was ever posted, and it was VAT-inclusive
 * while one dashboard card called it "profit".
 *
 * Net sales = Sales Revenue (4010) minus Sales Returns (4020), both ex-VAT,
 * exactly as postOrderDeliveredEntry and the returns refund post them. VAT is
 * the movement on VAT Payable (2030) in the same window. Dated by the journal
 * entry (recognition), not by when the order was placed.
 *
 * One currency at a time: amounts in different currencies cannot be added
 * (rule 1). Callers pass the org's presentation currency; lines in any other
 * currency are excluded rather than summed as if they were the same unit,
 * until ledger v2 carries functional-currency amounts.
 */
export interface SalesWindow {
    from: Date;
    /** Exclusive. */
    to?: Date;
    currency?: string;
}

export interface SalesTotals {
    netSalesMinor: bigint;
    vatMinor: bigint;
    /** net + VAT: what customers were charged, less refunds. */
    grossSalesMinor: bigint;
}

const SALES_CODES = [ACCOUNT_CODES.SALES_REVENUE, ACCOUNT_CODES.SALES_RETURNS, ACCOUNT_CODES.VAT_PAYABLE];

function windowConditions(orgId: string, window: SalesWindow) {
    return [
        eq(journalLines.orgId, orgId),
        eq(journalLines.currency, window.currency ?? 'EGP'),
        inArray(accounts.code, SALES_CODES),
        gte(journalEntries.entryDate, window.from),
        ...(window.to ? [lt(journalEntries.entryDate, window.to)] : []),
    ];
}

// credit - debit: positive for sales and VAT collected, negative for returns.
const signedNet = sql<string>`COALESCE(SUM(${journalLines.creditMinor} - ${journalLines.debitMinor}), 0)::text`;

function totalsFrom(byCode: Map<string, bigint>): SalesTotals {
    const netSalesMinor = (byCode.get(ACCOUNT_CODES.SALES_REVENUE) ?? 0n) + (byCode.get(ACCOUNT_CODES.SALES_RETURNS) ?? 0n);
    const vatMinor = byCode.get(ACCOUNT_CODES.VAT_PAYABLE) ?? 0n;
    return { netSalesMinor, vatMinor, grossSalesMinor: netSalesMinor + vatMinor };
}

/** Net sales, VAT and gross for one window. */
export async function salesTotals(tx: Pick<DbTx, 'select'>, orgId: string, window: SalesWindow): Promise<SalesTotals> {
    const rows = await tx
        .select({ code: accounts.code, amount: signedNet })
        .from(journalLines)
        .innerJoin(journalEntries, and(eq(journalEntries.id, journalLines.entryId), eq(journalEntries.orgId, journalLines.orgId)))
        .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, journalLines.orgId)))
        .where(and(...windowConditions(orgId, window)))
        .groupBy(accounts.code);
    return totalsFrom(new Map(rows.map((r) => [r.code, BigInt(r.amount)])));
}

/**
 * Net sales per UTC day. Only days with postings appear; callers fill gaps.
 * Keys are 'YYYY-MM-DD'.
 */
export async function dailyNetSales(tx: Pick<DbTx, 'select'>, orgId: string, window: SalesWindow): Promise<Map<string, bigint>> {
    const day = sql<string>`(date_trunc('day', ${journalEntries.entryDate})::date)::text`;
    const rows = await tx
        .select({ day, code: accounts.code, amount: signedNet })
        .from(journalLines)
        .innerJoin(journalEntries, and(eq(journalEntries.id, journalLines.entryId), eq(journalEntries.orgId, journalLines.orgId)))
        .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, journalLines.orgId)))
        .where(and(...windowConditions(orgId, window)))
        .groupBy(day, accounts.code);

    const byDay = new Map<string, bigint>();
    for (const row of rows) {
        if (row.code === ACCOUNT_CODES.VAT_PAYABLE) continue;
        byDay.set(row.day, (byDay.get(row.day) ?? 0n) + BigInt(row.amount));
    }
    return byDay;
}
