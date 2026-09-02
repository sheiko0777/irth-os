/**
 * Proves a delivered order books its sale — once, correctly, and never twice.
 *
 * WHY THIS EXISTS
 *
 * Three code paths move an order to 'delivered' and only one of them ever
 * posted revenue. `apps/api`'s PATCH /:id/status and the Bosta courier webhook
 * wrote the audit row, notified the customer and queued the ETA e-invoice while
 * booking no revenue, no VAT, no COGS and no receivable — so a delivered parcel
 * produced a filed tax invoice for a sale the ledger never recorded.
 *
 * `revenuePostingGate.test.ts` in apps/api proves every such route now CALLS
 * the shared posting. This file proves the posting itself is right: correct
 * accounts, correct VAT split, balanced, and protected against the double-post
 * that wiring two more callers made reachable for the first time.
 *
 * Follows this directory's boundary (see pnl.test.ts): it drives the
 * packages/db call the routes make, against real Postgres, rather than going
 * through tRPC or Hono.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  journalEntries,
  journalLines,
  accounts,
  orders,
  orderItems,
  organizations,
  products,
  productVariants,
  postOrderDeliveredEntry,
  withOrgContext,
  ACCOUNT_CODES,
} from '@irth/db';
import { EGP, EGYPT_VAT_BP, fromMinor, netOfTax, taxIncludedIn } from '@irth/domain';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgId: string;
let variantId: string;
let seq = 0;

const GROSS = 11_400n; // 114.00 EGP — 100.00 net + 14.00 VAT at the Egyptian rate
const COST = 4_000n;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Revenue Org', slug: `rev-${Date.now()}` }).returning();
  orgId = org.id;

  const [product] = await testDb.insert(products).values({
    orgId, name: 'Widget', sku: `SKU-${Date.now()}`, priceMinor: GROSS, currency: 'EGP',
  }).returning();
  const [variant] = await testDb.insert(productVariants).values({
    orgId, productId: product.id, name: 'Default', sku: `V-${Date.now()}`, priceMinor: GROSS,
  }).returning();
  variantId = variant.id;
});

afterAll(async () => {
  await closeTestDb();
});

/** An order sitting at `shipped`, with one costed line, ready to be delivered. */
async function seedOrder(opts: { totalAmountMinor?: bigint; costMinor?: bigint | null } = {}) {
  const total = opts.totalAmountMinor ?? GROSS;
  const [order] = await testDb.insert(orders).values({
    orgId,
    orderNumber: `IRT-REV-${++seq}-${Date.now()}`,
    status: 'shipped',
    totalAmountMinor: total,
    currency: 'EGP',
  }).returning();

  await testDb.insert(orderItems).values({
    orgId,
    orderId: order.id,
    variantId,
    quantity: 1,
    priceMinor: total,
    costMinor: opts.costMinor === undefined ? COST : opts.costMinor,
  });

  return order;
}

/** Every line of the entry, keyed by account code. */
async function linesByCode(entryId: string) {
  const rows = await testDb
    .select({ code: accounts.code, debit: journalLines.debitMinor, credit: journalLines.creditMinor })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entryId));
  return new Map(rows.map((r) => [r.code, r]));
}

describe('order delivered → revenue posting', () => {
  it('books gross receivable, net revenue, VAT and COGS in one balanced entry', async () => {
    const order = await seedOrder();

    const posted = await withOrgContext(testDb, orgId, (tx) =>
      postOrderDeliveredEntry(tx, {
        orgId, order, previousStatus: 'shipped', newStatus: 'delivered', createdBy: null,
      }),
    );

    expect(posted).not.toBeNull();

    const gross = fromMinor(GROSS, EGP);
    const expectedVat = taxIncludedIn(gross, EGYPT_VAT_BP).minor;
    const expectedNet = netOfTax(gross, EGYPT_VAT_BP).minor;

    const lines = await linesByCode(posted!.id);
    expect(lines.get(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE_COD)?.debit).toBe(GROSS);
    expect(lines.get(ACCOUNT_CODES.SALES_REVENUE)?.credit).toBe(expectedNet);
    expect(lines.get(ACCOUNT_CODES.VAT_PAYABLE)?.credit).toBe(expectedVat);
    expect(lines.get(ACCOUNT_CODES.COGS)?.debit).toBe(COST);
    expect(lines.get(ACCOUNT_CODES.INVENTORY)?.credit).toBe(COST);

    // The invariant the deferred trigger also enforces, asserted here so a
    // failure names the arithmetic rather than a constraint violation.
    let debit = 0n, credit = 0n;
    for (const l of lines.values()) { debit += l.debit; credit += l.credit; }
    expect(debit).toBe(credit);
    expect(expectedNet + expectedVat).toBe(GROSS);
  });

  it('omits COGS when no line has a known cost basis', async () => {
    const order = await seedOrder({ costMinor: null });

    const posted = await withOrgContext(testDb, orgId, (tx) =>
      postOrderDeliveredEntry(tx, {
        orgId, order, previousStatus: 'shipped', newStatus: 'delivered', createdBy: null,
      }),
    );

    const lines = await linesByCode(posted!.id);
    // NULL cost means unknown, not free — the line is excluded rather than
    // booked as zero-cost, which would overstate margin.
    expect(lines.has(ACCOUNT_CODES.COGS)).toBe(false);
    expect(lines.get(ACCOUNT_CODES.SALES_REVENUE)).toBeDefined();
  });

  it('posts nothing when the order was already delivered', async () => {
    const order = await seedOrder();
    const posted = await withOrgContext(testDb, orgId, (tx) =>
      postOrderDeliveredEntry(tx, {
        orgId, order, previousStatus: 'delivered', newStatus: 'delivered', createdBy: null,
      }),
    );
    expect(posted).toBeNull();
  });

  it('posts nothing for a zero-total order', async () => {
    const order = await seedOrder({ totalAmountMinor: 0n });
    const posted = await withOrgContext(testDb, orgId, (tx) =>
      postOrderDeliveredEntry(tx, {
        orgId, order, previousStatus: 'shipped', newStatus: 'delivered', createdBy: null,
      }),
    );
    expect(posted).toBeNull();
  });

  it('refuses a second sale for the same order, even when both callers saw shipped', async () => {
    const order = await seedOrder();

    // Both calls pass previousStatus 'shipped' on purpose. That is exactly the
    // race the application guard cannot close: the courier webhook and a manual
    // PATCH each READ the order before either UPDATE lands, so both observe
    // 'shipped' and both believe they are the genuine transition. The partial
    // unique index from 0049 is what actually stops the second one.
    await withOrgContext(testDb, orgId, (tx) =>
      postOrderDeliveredEntry(tx, {
        orgId, order, previousStatus: 'shipped', newStatus: 'delivered', createdBy: null,
      }),
    );

    await expect(
      withOrgContext(testDb, orgId, (tx) =>
        postOrderDeliveredEntry(tx, {
          orgId, order, previousStatus: 'shipped', newStatus: 'delivered', createdBy: null,
        }),
      ),
    ).rejects.toThrow();

    const entries = await testDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.sourceTable, 'orders'),
        eq(journalEntries.sourceId, order.id),
      ));
    expect(entries).toHaveLength(1);
  });
});
