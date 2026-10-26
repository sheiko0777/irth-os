/**
 * OR-10 against real Postgres: candidate promotion is atomic (the deferred
 * orders_items_match_candidate trigger is asserted at COMMIT), idempotent for a
 * same-version redelivery, serialized per source order, projects
 * custom_nonstock lines without stock changes, never auto-links customers by
 * email, and refuses blocked candidates before they enter orders.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  customerIdentities,
  customers,
  inventoryItems,
  orderImportCandidates,
  orderItems,
  orderSourceFulfillments,
  orderSourceRefunds,
  orderSourceTransactions,
  orders,
  organizations,
  outboxEvents,
  products,
  productVariants,
  promoteCandidate,
  shopifyConnections,
  variantSourceLinks,
  withOrgContext,
} from '@irth/db';
import { SECTIONS, type Blocker, type CandidateOrder, type Sections } from '@irth/domain';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let seq = 0;

type Seeded = Awaited<ReturnType<typeof seed>>;

// drizzle wraps driver errors: the SQLSTATE is on err.cause, not err.
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

const promote = (seeded: Seeded, candidateId: string) =>
  withOrgContext(testDb, seeded.orgId, (tx) => promoteCandidate(tx, { orgId: seeded.orgId, candidateId }));

const ordersFor = (sourceOrderId: string) =>
  testDb.select({ id: orders.id, acceptedCandidateId: orders.acceptedCandidateId, customerId: orders.customerId })
    .from(orders).where(eq(orders.sourceOrderId, sourceOrderId));

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

describe('promoteCandidate (OR-10)', () => {
  it('promotes a Shopify candidate with mapped and custom_nonstock lines without touching inventory', async () => {
    const seeded = await seed(`promote-${++seq}`);
    const candidate = buildCandidate(seeded, `gid://shopify/Order/${seq}`);
    const candidateId = await insertCandidate(seeded, candidate);

    const outcome = await promote(seeded, candidateId);

    expect(outcome.status).toBe('promoted');
    if (outcome.status !== 'promoted') throw new Error('expected promoted');

    const [order] = await testDb.select().from(orders).where(eq(orders.id, outcome.orderId));
    expect(order).toMatchObject({
      orgId: seeded.orgId,
      source: 'shopify',
      connectionId: seeded.connectionId,
      sourceOrderId: candidate.header.source_order_id,
      sourceOrderNumber: candidate.header.source_order_number,
      acceptedCandidateId: candidateId,
      totalAmountMinor: 2600n,
      shippingMinor: 100n,
      currency: 'EGP',
      customerId: null, // guest: buyer snapshot only
      buyer: { name: 'Guest Buyer', email: 'guest@example.test', phone: '+201000000000' },
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled', // 'UNFULFILLED' must not read as fulfilled
      settlementStatus: 'unsettled',
    });
    expect(order.sections).toEqual(loadedSections());
    expect(await testDb.select({ id: customers.id }).from(customers).where(eq(customers.orgId, seeded.orgId))).toEqual([]);

    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, outcome.orderId));
    expect(items).toHaveLength(2);
    expect(items.find((line) => line.lineKind === 'mapped')).toMatchObject({ variantId: seeded.variantId, quantity: 2, priceMinor: 1000n, title: 'Serum' });
    expect(items.find((line) => line.lineKind === 'custom_nonstock')).toMatchObject({ variantId: null, title: 'Gift wrap' });

    expect(await count(orderSourceTransactions, outcome.orderId)).toBe(1);
    expect(await count(orderSourceRefunds, outcome.orderId)).toBe(1);
    expect(await count(orderSourceFulfillments, outcome.orderId)).toBe(1);

    const [promoted] = await testDb.select().from(orderImportCandidates).where(eq(orderImportCandidates.id, candidateId));
    expect(promoted.status).toBe('promoted');
    expect(promoted.promotedOrderId).toBe(outcome.orderId);

    const events = await testDb.select({ eventType: outboxEvents.eventType }).from(outboxEvents)
      .where(inArray(outboxEvents.eventType, ['order.accepted', 'inventory.reserve']));
    expect(events.map((event) => event.eventType).sort()).toEqual(['inventory.reserve', 'order.accepted']);

    const [stock] = await testDb.select({ quantity: inventoryItems.quantity }).from(inventoryItems)
      .where(eq(inventoryItems.variantId, seeded.variantId));
    expect(stock.quantity).toBe(10);
  });

  it('rolls back everything when the transaction fails after the items are written', async () => {
    const seeded = await seed(`rollback-${++seq}`);
    const candidate = buildCandidate(seeded, `gid://shopify/Order/${seq}`);
    const candidateId = await insertCandidate(seeded, candidate);

    await expect(withOrgContext(testDb, seeded.orgId, async (tx) => {
      const outcome = await promoteCandidate(tx, { orgId: seeded.orgId, candidateId });
      expect(outcome.status).toBe('promoted'); // header, items, children all written...
      throw new Error('forced failure after items insert'); // ...then the tx dies
    })).rejects.toThrow(/forced failure/);

    expect(await ordersFor(candidate.header.source_order_id)).toEqual([]);
    expect(await testDb.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orgId, seeded.orgId))).toEqual([]);
    expect(await testDb.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.orgId, seeded.orgId))).toEqual([]);
    const [still] = await testDb.select().from(orderImportCandidates).where(eq(orderImportCandidates.id, candidateId));
    expect(still).toMatchObject({ status: 'hydrating', promotedOrderId: null });
  });

  it('fails at COMMIT (deferred trigger) when line_count disagrees with the written items, leaving no order', async () => {
    const seeded = await seed(`commit-${++seq}`);
    const candidate = buildCandidate(seeded, `gid://shopify/Order/${seq}`);
    const candidateId = await insertCandidate(seeded, candidate, { lineCount: 3 });

    let inTxStatus: string | undefined;
    const code = await pgCode(withOrgContext(testDb, seeded.orgId, async (tx) => {
      inTxStatus = (await promoteCandidate(tx, { orgId: seeded.orgId, candidateId })).status;
    }));

    expect(inTxStatus).toBe('promoted'); // every statement succeeded inside the tx
    expect(code).toBe('23514'); // the COMMIT itself was refused
    expect(await ordersFor(candidate.header.source_order_id)).toEqual([]);
  });

  it('does not create a second order for a same-version redelivery', async () => {
    const seeded = await seed(`same-version-${++seq}`);
    const candidate = buildCandidate(seeded, `gid://shopify/Order/${seq}`);
    const candidateId = await insertCandidate(seeded, candidate);

    const first = await promote(seeded, candidateId);
    const second = await promote(seeded, candidateId);

    expect(first.status).toBe('promoted');
    expect(second).toEqual(first);
    expect(await ordersFor(candidate.header.source_order_id)).toHaveLength(1);
  });

  it('supersedes an older version that arrives after a newer one was accepted', async () => {
    const seeded = await seed(`revision-${++seq}`);
    const sourceOrderId = `gid://shopify/Order/${seq}`;
    const newerId = await insertCandidate(seeded, buildCandidate(seeded, sourceOrderId, '2026-10-01T11:00:00.000Z'));
    const olderId = await insertCandidate(seeded, buildCandidate(seeded, sourceOrderId, '2026-10-01T10:00:00.000Z'));

    const newer = await promote(seeded, newerId);
    const older = await promote(seeded, olderId);

    expect(newer.status).toBe('promoted');
    expect(older.status).toBe('superseded');
    const rows = await ordersFor(sourceOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].acceptedCandidateId).toBe(newerId);
  });

  it('serializes two concurrent promotions of the same source order: one order, no 23505', async () => {
    const seeded = await seed(`race-${++seq}`);
    const sourceOrderId = `gid://shopify/Order/${seq}`;
    const aId = await insertCandidate(seeded, buildCandidate(seeded, sourceOrderId, '2026-10-01T10:00:00.000Z'));
    const bId = await insertCandidate(seeded, buildCandidate(seeded, sourceOrderId, '2026-10-01T11:00:00.000Z'));

    const outcomes = await Promise.all([promote(seeded, aId), promote(seeded, bId)]);

    expect(outcomes.every((o) => o.status === 'promoted' || o.status === 'superseded')).toBe(true);
    const rows = await ordersFor(sourceOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].acceptedCandidateId).toBe(bId); // the newer version always wins
  });

  it('links a registered buyer by provider id only and never auto-links by email', async () => {
    const seeded = await seed(`customer-${++seq}`);
    const buyer = { source_customer_id: 'gid://shopify/Customer/7', name: 'Mona', email: 'mona@example.test', is_guest: false };
    const first = buildCandidate(seeded, `gid://shopify/Order/${seq}-a`);
    const again = buildCandidate(seeded, `gid://shopify/Order/${seq}-b`);
    const sameEmail = buildCandidate(seeded, `gid://shopify/Order/${seq}-c`);
    first.buyer = buyer;
    again.buyer = buyer;
    sameEmail.buyer = { ...buyer, source_customer_id: 'gid://shopify/Customer/8' };

    for (const c of [first, again, sameEmail]) {
      expect((await promote(seeded, await insertCandidate(seeded, c))).status).toBe('promoted');
    }

    const [a] = await ordersFor(first.header.source_order_id);
    const [b] = await ordersFor(again.header.source_order_id);
    const [c] = await ordersFor(sameEmail.header.source_order_id);
    expect(a.customerId).not.toBeNull();
    expect(b.customerId).toBe(a.customerId); // same provider customer id -> same customer
    expect(c.customerId).not.toBe(a.customerId); // same email, different id -> NOT merged
    const shopifyIds = await testDb.select({ customerId: customerIdentities.customerId }).from(customerIdentities)
      .where(and(eq(customerIdentities.orgId, seeded.orgId), eq(customerIdentities.kind, 'shopify')));
    expect(shopifyIds).toHaveLength(2);
  });

  it('never promotes a second order when the legacy webhook already imported it', async () => {
    const seeded = await seed(`legacy-${++seq}`);
    const candidate = buildCandidate(seeded, `gid://shopify/Order/${seq}`);
    // Shape the legacy /orders-create handler writes: shopifyGid('Order', id), no connection, no candidate.
    const [legacy] = await testDb.insert(orders).values({
      orgId: seeded.orgId,
      orderNumber: `IRT-LEGACY-${seq}`,
      totalAmountMinor: 2600n,
      source: 'legacy_shopify',
      shopifyOrderId: candidate.header.source_order_id,
      sourceOrderId: candidate.header.source_order_id,
    }).returning();
    const candidateId = await insertCandidate(seeded, candidate);

    expect(await promote(seeded, candidateId)).toEqual({ status: 'superseded', orderId: legacy.id });

    expect(await ordersFor(candidate.header.source_order_id)).toHaveLength(1);
    const [row] = await testDb.select().from(orderImportCandidates).where(eq(orderImportCandidates.id, candidateId));
    expect(row).toMatchObject({ status: 'superseded', lastError: `legacy_order_exists:${legacy.id}` });
    expect(await testDb.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.orgId, seeded.orgId))).toEqual([]);
  });

  it('does not promote a blocked candidate', async () => {
    const seeded = await seed(`blocked-${++seq}`);
    const candidate = buildCandidate(seeded, `gid://shopify/Order/${seq}`);
    const blocker: Blocker = {
      code: 'line_unmapped',
      section: 'items',
      detail: '{"sourceLineId":"line-1"}',
      nextAction: 'orders.import.next.mapVariant',
    };
    const candidateId = await insertCandidate(seeded, candidate, { blockers: [blocker], status: 'blocked' });

    expect(await promote(seeded, candidateId)).toEqual({ status: 'blocked' });
    expect(await ordersFor(candidate.header.source_order_id)).toEqual([]);
  });
});

async function seed(tag: string) {
  const [org] = await testDb.insert(organizations).values({ name: tag, slug: tag }).returning();
  // One Shopify connection per org.
  const [connection] = await testDb.insert(shopifyConnections).values({
    orgId: org.id,
    shopDomain: `${tag}.myshopify.com`,
    accessTokenCiphertext: 'test-only',
    accessTokenIv: 'test-only',
    scopes: 'read_orders',
    apiVersion: '2026-07',
    pixelIngestionKey: `pixel-${tag}`,
  }).returning();
  const [product] = await testDb.insert(products).values({
    orgId: org.id,
    name: 'Serum',
    sku: `P-${tag}`,
    priceMinor: 1000n,
    currency: 'EGP',
  }).returning();
  const [variant] = await testDb.insert(productVariants).values({
    orgId: org.id,
    productId: product.id,
    name: '30ml',
    sku: `V-${tag}`,
    priceMinor: 1000n,
  }).returning();
  await testDb.insert(inventoryItems).values({ orgId: org.id, variantId: variant.id, quantity: 10 });
  await testDb.insert(variantSourceLinks).values([
    { orgId: org.id, connectionId: connection.id, sourceVariantId: `gid://shopify/ProductVariant/${tag}`, variantId: variant.id },
    { orgId: org.id, connectionId: connection.id, sourceVariantId: `line:custom-${tag}`, lineKind: 'custom_nonstock', variantId: null },
  ]);
  return { orgId: org.id, connectionId: connection.id, variantId: variant.id, tag };
}

async function insertCandidate(
  seeded: Seeded,
  candidate: CandidateOrder,
  opts: { blockers?: Blocker[]; status?: 'hydrating' | 'blocked'; lineCount?: number } = {},
) {
  const [row] = await testDb.insert(orderImportCandidates).values({
    orgId: seeded.orgId,
    connectionId: seeded.connectionId,
    provider: 'shopify',
    sourceOrderId: candidate.header.source_order_id,
    sourceOrderNumber: candidate.header.source_order_number,
    sourceUpdatedAt: new Date(candidate.header.source_updated_at),
    status: opts.status ?? 'hydrating',
    normalized: candidate,
    sections: loadedSections(),
    blockers: opts.blockers ?? [],
    lineCount: opts.lineCount ?? candidate.lines.length,
    apiVersion: '2026-07',
    connectorVersion: 'test',
  }).returning();
  return row.id;
}

function buildCandidate(seeded: Seeded, sourceOrderId: string, updatedAt = '2026-10-01T10:00:00.000Z'): CandidateOrder {
  return {
    header: {
      source_order_id: sourceOrderId,
      source_order_number: `#${1000 + seq}`,
      source_updated_at: updatedAt,
      source_created_at: '2026-10-01T09:30:00.000Z',
      financial_status: 'PAID',
      fulfillment_status: 'UNFULFILLED',
      currency_code: 'EGP',
      presentment_currency_code: 'EGP',
      subtotal_price_set: { shop_money_minor: '2500', presentment_money_minor: '2500' },
      total_price_set: { shop_money_minor: '2600', presentment_money_minor: '2600' },
      total_tax_set: { shop_money_minor: '0', presentment_money_minor: '0' },
      total_discounts_set: { shop_money_minor: '0', presentment_money_minor: '0' },
      total_shipping_set: { shop_money_minor: '100', presentment_money_minor: '100' },
      total_refunded_set: { shop_money_minor: '0', presentment_money_minor: '0' },
      total_outstanding_set: { shop_money_minor: '0', presentment_money_minor: '0' },
    },
    lines: [
      line(`line-mapped-${seeded.tag}`, `gid://shopify/ProductVariant/${seeded.tag}`, 'mapped', seeded.variantId, 2, '1000', '2000'),
      line(`custom-${seeded.tag}`, undefined, 'custom_nonstock', undefined, 1, '500', '500'),
    ],
    buyer: { name: 'Guest Buyer', email: 'guest@example.test', phone: '+201000000000', is_guest: true },
    addresses: { shipping: { name: 'Guest Buyer', address1: '1 Test St', city: 'Cairo', country: 'Egypt', phone: '+201000000000' } },
    price: {
      subtotal: '2500',
      discounts: '0',
      discount_codes: [],
      tax_lines: [],
      shipping: '100',
      additional_fees: '0',
      total: '2600',
      refunded: '0',
      outstanding: '0',
      taxes_included: false,
    },
    currency: { shop: 'EGP', presentment: 'EGP' },
    transactions: [{ source_transaction_id: `txn-${seeded.tag}`, kind: 'SALE', status: 'SUCCESS', gateway: 'bogus', amount_minor: '2600', processed_at: '2026-10-01T10:01:00.000Z' }],
    refunds: [{ source_refund_id: `refund-${seeded.tag}`, created_at: '2026-10-01T10:02:00.000Z', total_refunded_minor: '0' }],
    fulfillments: [{ source_fulfillment_id: `fulfillment-${seeded.tag}`, status: 'OPEN', tracking_numbers: [] }],
    context: { tags: [], custom_attributes: {}, is_test: false },
    evidence: { inbound_delivery_id: `delivery-${seeded.tag}`, api_version: '2026-07', connector_version: 'test', fetched_at: '2026-10-01T10:03:00.000Z' },
  };
}

function line(
  sourceLineId: string,
  sourceVariantId: string | undefined,
  state: 'mapped' | 'custom_nonstock',
  variantId: string | undefined,
  quantity: number,
  unit: string,
  total: string,
): CandidateOrder['lines'][number] {
  return {
    source_line_id: sourceLineId,
    title: sourceVariantId ? 'Serum' : 'Gift wrap',
    source_variant_id: sourceVariantId,
    quantity,
    current_quantity: quantity,
    unfulfilled_quantity: quantity,
    refundable_quantity: quantity,
    unit_price_minor: unit,
    discount_minor: '0',
    tax_minor: '0',
    total_minor: total,
    requires_shipping: state === 'mapped',
    taxable: true,
    custom_attributes: {},
    tax_lines: [],
    discount_allocations: [],
    mapping: state === 'mapped' ? { state, variant_id: variantId } : { state },
  };
}

function loadedSections(): Sections {
  return Object.fromEntries(SECTIONS.map((section) => [section, { status: 'loaded', fetchedAt: '2026-10-01T10:03:00.000Z' }])) as Sections;
}

async function count(table: typeof orderSourceTransactions | typeof orderSourceRefunds | typeof orderSourceFulfillments, orderId: string) {
  const rows = await testDb.select({ id: table.id }).from(table).where(eq(table.orderId, orderId));
  return rows.length;
}
