import { eq } from 'drizzle-orm';
import { EGYPT_VAT_BP, currency, fromMinor, netOfTax, taxIncludedIn } from '@irth/domain';
import { orderItems } from './schema';
import { ACCOUNT_CODES, postJournalEntry, type JournalLineInput } from './ledger';
import type { DbTx } from './index';

/**
 * Books revenue, VAT and COGS for an order that has just become `delivered`.
 *
 * WHY THIS EXISTS AS A SHARED FUNCTION
 *
 * Three code paths move an order to 'delivered':
 *
 *   apps/admin/src/server/routers/orders.ts  updateStatus (tRPC)
 *   apps/api/src/routes/orders.ts            PATCH /:id/status
 *   apps/api/src/routes/webhooks/bosta.ts    courier delivery scan
 *
 * Until this function existed, only the FIRST posted anything. The other two
 * wrote the audit row, emitted the customer notification and queued the ETA
 * e-invoice — and booked no revenue, no VAT, no COGS and no receivable. The
 * comment above the API twin's handler even claimed the transition "can post
 * ledger entries (revenue, COGS)"; the transaction below it posted none.
 *
 * The courier webhook is the path that fires in real operations, so the effect
 * was: a parcel is delivered, an ETA tax invoice is filed for the sale, and the
 * sale never appears in the ledger. Reports read the ledger (CLAUDE.md rule 2),
 * so revenue, VAT payable, COGS and AR-COD were all understated while the tax
 * authority had already been told the sale happened.
 *
 * Copying the posting block into the other two callers would have made three
 * copies of one business rule — the same class of defect being fixed here. One
 * implementation, three callers.
 *
 * TRANSACTION-ONLY BY TYPE
 *
 * `rollback` exists on PgTransaction and not on PostgresJsDatabase, so
 * `postOrderDeliveredEntry(db, …)` does not compile. The posting must commit
 * with the status change that caused it, or neither lands. Same guard as
 * `emitOutboxEvent`'s `OutboxWriter` in outbox.ts, and for the same reason.
 */
export interface PostOrderDeliveredInput {
    orgId: string;
    order: {
        id: string;
        orderNumber: string;
        currency: string;
        totalAmountMinor: bigint;
    };
    /** Status BEFORE the update that triggered this call. */
    previousStatus: string;
    /** Status AFTER it. */
    newStatus: string;
    createdBy?: string | null;
}

export async function postOrderDeliveredEntry(
    tx: Pick<DbTx, 'select' | 'insert' | 'rollback'>,
    input: PostOrderDeliveredInput,
): Promise<{ id: string } | null> {
    const { orgId, order, previousStatus, newStatus, createdBy } = input;

    // The transition guard lives HERE, not at each call site, so no caller can
    // forget it. Three conditions, each load-bearing:
    //
    //   newStatus === 'delivered'      only a sale that completed is recognised
    //   previousStatus !== 'delivered' a genuine TRANSITION. None of the three
    //                                  callers' UPDATEs carry a ne(status)
    //                                  clause, so re-saving an already-
    //                                  delivered order returns a row happily
    //                                  and would double-book revenue.
    //   totalAmountMinor > 0n          checked BEFORE currency() is touched at
    //                                  all: a zero-total order has nothing to
    //                                  recognise, and there is no reason to
    //                                  validate a currency code for a posting
    //                                  about to be skipped. It would also build
    //                                  a line that is neither debit nor credit,
    //                                  which postJournalEntry correctly refuses.
    // Negated as a whole rather than de Morgan'd into `!== / === / <=`. The
    // three positive comparisons are the ones the tRPC router used before this
    // was extracted, and they must keep their exact semantics for a malformed
    // or partial `order`: `undefined > 0n` is false, so the original SKIPPED.
    // `undefined <= 0n` is ALSO false, so the inverted form would have
    // PROCEEDED, and then thrown inside currency(undefined). Same three
    // conditions, same short-circuit, no accidental change of behaviour at the
    // edges.
    if (!(newStatus === 'delivered' && previousStatus !== 'delivered' && order.totalAmountMinor > 0n)) {
        return null;
    }

    const gross = fromMinor(order.totalAmountMinor, currency(order.currency));
    const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
    const net = netOfTax(gross, EGYPT_VAT_BP);

    const lines: JournalLineInput[] = [
        { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, debitMinor: gross.minor, memo: 'Gross, VAT-inclusive' },
        { accountCode: ACCOUNT_CODES.SALES_REVENUE, creditMinor: net.minor },
        { accountCode: ACCOUNT_CODES.VAT_PAYABLE, creditMinor: vat.minor },
    ];

    // COGS rides in the same entry when a cost basis is known. `costMinor` is
    // populated at order CREATION (apps/api/src/routes/orders.ts, 0039) from
    // the variant's weighted-average cost at that moment — NULL means unknown,
    // not free, so unknown lines are excluded rather than treated as zero cost,
    // and the memo records how many were left out.
    const costRows = await tx
        .select({ costMinor: orderItems.costMinor })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));
    const knownCostRows = costRows.filter((r) => r.costMinor != null);
    const totalCostMinor = knownCostRows.reduce((acc, r) => acc + (r.costMinor as bigint), 0n);

    if (totalCostMinor > 0n) {
        const gap = costRows.length - knownCostRows.length;
        const memo = gap > 0
            ? `${gap} of ${costRows.length} line(s) had no known cost basis and are excluded`
            : undefined;
        lines.push(
            { accountCode: ACCOUNT_CODES.COGS, debitMinor: totalCostMinor, memo },
            { accountCode: ACCOUNT_CODES.INVENTORY, creditMinor: totalCostMinor, memo },
        );
    }

    return postJournalEntry(tx, {
        orgId,
        journalType: 'sales',
        description: `Order delivered — ${order.orderNumber}`,
        sourceTable: 'orders',
        sourceId: order.id,
        createdBy: createdBy ?? null,
        lines,
    });
}
