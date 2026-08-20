/**
 * The composed flow a real order lifecycle produces: goods received (costing
 * a receipt, so the item has an average cost) → revenue and COGS recognised
 * together → the grouped aggregation finance.pnl reads.
 *
 * Router-level correctness (does orders.updateStatus call postJournalEntry
 * with the right fields) is established by typecheck and by reasoning about
 * the code, matching this test suite's existing boundary — every integration
 * test in this directory exercises database mechanisms directly, never
 * through the tRPC layer (no test here calls `.createCaller`). This file
 * follows that boundary: it drives the same SEQUENCE of packages/db calls
 * purchasing.receive and orders.updateStatus make, against real Postgres,
 * and then re-derives finance.pnl's own aggregation query to prove the
 * numbers it would compute are correct — the part of that rewrite most likely
 * to hide a bug (join predicates, which normal_balance sign to apply).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql, sum } from 'drizzle-orm';
import {
  accounts,
  inventoryItems,
  journalEntries,
  journalLines,
  organizations,
  products,
  productVariants,
  postJournalEntry,
  recordCostedReceipt,
  withOrgContext,
  ACCOUNT_CODES,
  type JournalLineInput,
} from '@irth/db';
import { EGP, EGYPT_VAT_BP, fromMinor, netOfTax, taxIncludedIn } from '@irth/domain';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgId: string;
let variantId: string;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'PnL Org', slug: `pnl-${Date.now()}` }).returning();
  orgId = org.id;

  const [product] = await testDb.insert(products).values({
    orgId, name: 'Widget', sku: `SKU-${Date.now()}`, priceMinor: 5000n, currency: 'EGP',
  }).returning();
  const [variant] = await testDb.insert(productVariants).values({
    orgId, productId: product.id, name: 'Default', sku: `V-${Date.now()}`, priceMinor: 5000n,
  }).returning();
  variantId = variant.id;
});

afterAll(async () => {
  await closeTestDb();
});

/** Mirrors finance.ts's own accountBalanceMinor exactly, so a divergence here would be a real bug in the copy, not a test artifact. */
function balanceMinor(row: { normalBalance: string; debit: string | null; credit: string | null }): bigint {
  const debit = BigInt(row.debit ?? '0');
  const credit = BigInt(row.credit ?? '0');
  return row.normalBalance === 'debit' ? debit - credit : credit - debit;
}

describe('goods received → order delivered → pnl aggregation', () => {
  it('produces a correct COGS figure from a real weighted-average cost, and a correct VAT split', async () => {
    const [invItem] = await testDb.insert(inventoryItems)
      .values({ orgId, variantId, quantity: 0 }).returning();

    // Goods received: 20 units at 300 piastres each (6000 total). Mirrors
    // purchasing.receive's own sequence — recordCostedReceipt BEFORE the
    // quantity increment, then the goods-received posting.
    await withOrgContext(testDb, orgId, async (tx) => {
      await recordCostedReceipt(tx, {
        orgId, itemId: invItem.id, quantity: 20, totalCostMinor: 6000n, note: 'test receipt',
      });
      await tx.update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} + 20` })
        .where(eq(inventoryItems.id, invItem.id));

      await postJournalEntry(tx, {
        orgId, journalType: 'purchases', description: 'Goods received',
        sourceTable: 'purchase_orders', sourceId: invItem.id,
        lines: [
          { accountCode: ACCOUNT_CODES.INVENTORY, debitMinor: 6000n },
          { accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE, creditMinor: 6000n },
        ],
      });
    });

    const [afterReceipt] = await testDb.select({ averageCostMinor: inventoryItems.averageCostMinor })
      .from(inventoryItems).where(eq(inventoryItems.id, invItem.id));
    // 6000 / 20 = 300 per unit.
    expect(afterReceipt.averageCostMinor).toBe(300n);

    // Order delivered: 5 units sold at the order's own price (unrelated to
    // cost), gross 1140.00 (VAT-inclusive). Cost basis = 5 x 300 = 1500,
    // exactly as apps/api/src/routes/orders.ts would have captured it at
    // decrement time.
    const gross = fromMinor(114000n, EGP); // 1140.00
    const vat = taxIncludedIn(gross, EGYPT_VAT_BP);
    const net = netOfTax(gross, EGYPT_VAT_BP);
    const costMinor = 5n * 300n;

    await withOrgContext(testDb, orgId, async (tx) => {
      const lines: JournalLineInput[] = [
        { accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD, debitMinor: gross.minor },
        { accountCode: ACCOUNT_CODES.SALES_REVENUE, creditMinor: net.minor },
        { accountCode: ACCOUNT_CODES.VAT_PAYABLE, creditMinor: vat.minor },
        { accountCode: ACCOUNT_CODES.COGS, debitMinor: costMinor },
        { accountCode: ACCOUNT_CODES.INVENTORY, creditMinor: costMinor },
      ];
      await postJournalEntry(tx, {
        orgId, journalType: 'sales', description: 'Order delivered',
        sourceTable: 'orders', sourceId: invItem.id, lines,
      });
    });

    // Re-derive finance.pnl's own query, exactly.
    const rows = await testDb
      .select({
        code: accounts.code,
        normalBalance: accounts.normalBalance,
        debit: sum(journalLines.debitMinor),
        credit: sum(journalLines.creditMinor),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(eq(journalLines.orgId, orgId))
      .groupBy(accounts.code, accounts.normalBalance);

    const byCode = new Map(rows.map((r) => [r.code, balanceMinor(r)]));

    // Revenue: net.minor from the sale (1000.00 — 1140.00 gross less 140.00 VAT).
    expect(byCode.get(ACCOUNT_CODES.SALES_REVENUE)).toBe(100000n);
    // VAT payable: 140.00.
    expect(byCode.get(ACCOUNT_CODES.VAT_PAYABLE)).toBe(14000n);
    // COGS: 5 units x 300 = 1500 minor units (15.00 EGP).
    expect(byCode.get(ACCOUNT_CODES.COGS)).toBe(1500n);
    // Inventory: +6000 received, -1500 sold = 4500 net (still holding 15 units
    // worth 300 each).
    expect(byCode.get(ACCOUNT_CODES.INVENTORY)).toBe(4500n);
    // Accounts payable: the 6000 owed the supplier, untouched by the sale.
    expect(byCode.get(ACCOUNT_CODES.ACCOUNTS_PAYABLE)).toBe(6000n);
    // Receivable: the 1140.00 gross owed by the customer (COD, not yet remitted).
    expect(byCode.get(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD)).toBe(114000n);

    // The P&L figures finance.pnl would compute from these same balances.
    const grossRevenueMinor = byCode.get(ACCOUNT_CODES.SALES_REVENUE) ?? 0n;
    const cogsMinor = byCode.get(ACCOUNT_CODES.COGS) ?? 0n;
    const grossProfitMinor = grossRevenueMinor - cogsMinor;
    expect(grossProfitMinor).toBe(98500n); // 985.00 EGP gross profit on this sale
  });
});
