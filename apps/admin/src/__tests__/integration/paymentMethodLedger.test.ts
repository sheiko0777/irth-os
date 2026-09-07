/**
 * F14: `postOrderDeliveredEntry` must post the delivered-order receivable to
 * the correct asset account based on how the order was actually paid — an
 * online-captured order (Paymob, or a Shopify order whose
 * `payment_gateway_names` doesn't include a COD-style gateway) has already
 * had its cash captured before delivery, so it must NOT land in the same
 * `ACCOUNTS_RECEIVABLE_COD` bucket a real un-remitted COD order sits in.
 * `finance.codReconciliation` then filters on `orders.paymentMethod = 'cod'`,
 * so a wrong account here would also make that report wrong (tested here at
 * the ledger layer, which is where the actual money-handling defect lived).
 *
 * `postOrderDeliveredEntry` never reads its `order` argument from the
 * database — it only uses it to compute the posting — so this test can pass
 * a plain object shaped like `PostOrderDeliveredInput['order']` without
 * inserting a real `orders` row; the only real row needed is the
 * organization itself (postJournalEntry auto-provisions the chart of
 * accounts for it on first use).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  accounts,
  journalEntries,
  journalLines,
  organizations,
  postOrderDeliveredEntry,
  withOrgContext,
  ACCOUNT_CODES,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgId: string;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Payment Method Org', slug: `pm-${Date.now()}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('postOrderDeliveredEntry — payment-method-scoped receivable account', () => {
  it('debits ACCOUNTS_RECEIVABLE_ONLINE for an online-paid order, not the COD bucket', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000001';
    await withOrgContext(testDb, orgId, async (tx) => {
      await postOrderDeliveredEntry(tx, {
        orgId,
        order: { id: orderId, orderNumber: 'ONL-1', currency: 'EGP', totalAmountMinor: 10000n, paymentMethod: 'online' },
        previousStatus: 'shipped',
        newStatus: 'delivered',
        createdBy: null,
      });
    });

    // sourceId lives on journal_entries (postOrderDeliveredEntry sets
    // sourceTable: 'orders', sourceId: order.id there), not on journal_lines
    // — join through it, exactly like pnl.test.ts's own query does.
    const debitRow = await testDb
      .select({ code: accounts.code })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(eq(journalEntries.sourceId, orderId));
    const receivableRow = debitRow.find((r) => r.code === ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_ONLINE || r.code === ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD);

    expect(receivableRow?.code).toBe(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_ONLINE);
  });

  it('debits ACCOUNTS_RECEIVABLE_COD for a cod order (and for a null/missing paymentMethod, the safe default)', async () => {
    const codOrderId = 'aaaaaaaa-0000-0000-0000-000000000002';
    const unknownOrderId = 'aaaaaaaa-0000-0000-0000-000000000003';

    await withOrgContext(testDb, orgId, async (tx) => {
      await postOrderDeliveredEntry(tx, {
        orgId,
        order: { id: codOrderId, orderNumber: 'COD-1', currency: 'EGP', totalAmountMinor: 10000n, paymentMethod: 'cod' },
        previousStatus: 'shipped',
        newStatus: 'delivered',
        createdBy: null,
      });
      await postOrderDeliveredEntry(tx, {
        orgId,
        // No paymentMethod at all — must not throw, must fall back to COD.
        order: { id: unknownOrderId, orderNumber: 'UNK-1', currency: 'EGP', totalAmountMinor: 10000n },
        previousStatus: 'shipped',
        newStatus: 'delivered',
        createdBy: null,
      });
    });

    for (const orderId of [codOrderId, unknownOrderId]) {
      const rows = await testDb
        .select({ code: accounts.code })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(eq(journalEntries.sourceId, orderId));
      const receivableRow = rows.find((r) => r.code === ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_ONLINE || r.code === ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD);
      expect(receivableRow?.code).toBe(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD);
    }
  });
});
