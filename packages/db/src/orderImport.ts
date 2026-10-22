import { CandidateOrderSchema, type CandidateOrder, type Sections } from '@irth/domain';
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { DbTx } from './index';
import { findCustomerByIdentity, upsertIdentity } from './customers';
import { emitOutboxEvents } from './outbox';
import { isUniqueViolation } from './pgError';
import {
  customers,
  formatDocumentNumber,
  nextDocumentNumber,
  orderImportCandidates,
  orderItems,
  orderSourceFulfillments,
  orderSourceRefunds,
  orderSourceTransactions,
  orders,
} from './index';

// OR-10: atomic promotion of an order_import_candidates row into orders +
// order_items + order_source_* children. Runs inside the caller's
// withOrgContext transaction (FORCE RLS); every statement also filters org_id.
// The deferred orders_items_match_candidate trigger (0086) re-checks the item
// count against candidate.line_count at COMMIT, so a partial write cannot land.
// No stock moves here: reservation is requested via an 'inventory.reserve'
// outbox event for IN to consume.

export type PromotionOutcome =
  | { status: 'promoted'; orderId: string }
  | { status: 'superseded'; orderId: string | null }
  | { status: 'blocked' };

export interface PromoteCandidateInput {
  orgId: string;
  candidateId: string;
}

export async function promoteCandidate(tx: DbTx, input: PromoteCandidateInput): Promise<PromotionOutcome> {
  const byId = and(eq(orderImportCandidates.id, input.candidateId), eq(orderImportCandidates.orgId, input.orgId));

  // connection_id/source_order_id never change on a candidate, so reading them
  // before the lock is safe; the lock serializes per source order even when no
  // orders row exists yet (FOR UPDATE alone could not).
  const [key] = await tx.select({
    connectionId: orderImportCandidates.connectionId,
    sourceOrderId: orderImportCandidates.sourceOrderId,
  }).from(orderImportCandidates).where(byId).limit(1);
  if (!key?.connectionId) return { status: 'blocked' };
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${key.connectionId}:${key.sourceOrderId}`}))`);

  const [candidate] = await tx.select().from(orderImportCandidates).where(byId).for('update');
  if (!candidate?.connectionId) return { status: 'blocked' };
  if (candidate.status === 'promoted' && candidate.promotedOrderId) return { status: 'promoted', orderId: candidate.promotedOrderId };
  if (candidate.status === 'superseded') return { status: 'superseded', orderId: candidate.promotedOrderId };
  if (candidate.status !== 'hydrating' || (candidate.blockers as unknown[]).length > 0) return { status: 'blocked' };

  const connectionId = candidate.connectionId;
  // line_count vs. written items is enforced at COMMIT by the deferred trigger.
  const normalized = CandidateOrderSchema.parse(candidate.normalized);
  const sections = candidate.sections as Sections;
  const sameSourceOrder = and(
    eq(orders.orgId, input.orgId),
    eq(orders.connectionId, connectionId),
    eq(orders.sourceOrderId, candidate.sourceOrderId),
  );

  // A newer version was already accepted: this one is stale.
  const [newer] = await tx.select({ promotedOrderId: orderImportCandidates.promotedOrderId })
    .from(orderImportCandidates)
    .where(and(
      eq(orderImportCandidates.orgId, input.orgId),
      eq(orderImportCandidates.provider, candidate.provider),
      eq(orderImportCandidates.connectionId, connectionId),
      eq(orderImportCandidates.sourceOrderId, candidate.sourceOrderId),
      gt(orderImportCandidates.sourceUpdatedAt, candidate.sourceUpdatedAt),
      eq(orderImportCandidates.status, 'promoted'),
    ))
    .limit(1);
  if (newer) {
    await supersede(tx, input.orgId, candidate.id, newer.promotedOrderId);
    return { status: 'superseded', orderId: newer.promotedOrderId };
  }

  const [existing] = await tx.select({ id: orders.id, sourceUpdatedAt: orders.sourceUpdatedAt })
    .from(orders).where(sameSourceOrder).for('update');

  let orderId: string;
  if (existing) {
    if (existing.sourceUpdatedAt && existing.sourceUpdatedAt >= candidate.sourceUpdatedAt) {
      await supersede(tx, input.orgId, candidate.id, existing.id);
      return { status: 'superseded', orderId: existing.id };
    }
    // ponytail: OR-10 refreshes header + upserts lines/children by source id;
    // OR-11 owns revision semantics (pending revisions, cancellation events).
    const customerId = await findOrCreateCustomer(tx, input.orgId, connectionId, normalized);
    await tx.update(orders)
      .set({ ...orderValues(input.orgId, candidate.id, connectionId, normalized, sections, customerId), updatedAt: new Date() })
      .where(and(eq(orders.id, existing.id), eq(orders.orgId, input.orgId)));
    orderId = existing.id;
  } else {
    // The legacy /orders-create webhook (source NULL / 'legacy_shopify',
    // connection_id NULL) may already hold this Shopify order; the
    // (connection_id, source_order_id) index cannot see it. Never promote a
    // second order for it. Legacy rows store shopifyGid('Order', id); very
    // old rows may hold the bare numeric id.
    const legacyIds = [candidate.sourceOrderId];
    const numericTail = /^gid:\/\/shopify\/Order\/(\d+)$/.exec(candidate.sourceOrderId)?.[1];
    if (numericTail) legacyIds.push(numericTail);
    const [legacy] = await tx.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.orgId, input.orgId), inArray(orders.shopifyOrderId, legacyIds)))
      .limit(1);
    if (legacy) {
      await supersede(tx, input.orgId, candidate.id, legacy.id, `legacy_order_exists:${legacy.id}`);
      return { status: 'superseded', orderId: legacy.id };
    }
    try {
      // Savepoint: a 23505 aborts only the savepoint, so the race can be
      // resolved below instead of poisoning the whole transaction.
      orderId = await tx.transaction((sp) => insertOrder(sp, input.orgId, candidate.id, connectionId, normalized, sections));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Unreachable for writers that take the advisory lock; kept as the
      // backstop the packet requires — never let a 23505 escape.
      const [raced] = await tx.select({ id: orders.id, sourceUpdatedAt: orders.sourceUpdatedAt }).from(orders).where(sameSourceOrder);
      if (raced?.sourceUpdatedAt && raced.sourceUpdatedAt >= candidate.sourceUpdatedAt) {
        await supersede(tx, input.orgId, candidate.id, raced.id);
        return { status: 'superseded', orderId: raced.id };
      }
      throw new Error(`order promotion for candidate ${candidate.id} raced a concurrent write; retry`);
    }
  }

  await upsertOrderItems(tx, input.orgId, orderId, normalized.lines);
  await upsertSourceChildren(tx, input.orgId, orderId, normalized);
  await markPromoted(tx, input.orgId, candidate, orderId);
  await emitOutboxEvents(tx, [
    { orgId: input.orgId, eventType: 'order.accepted', payload: { orgId: input.orgId, orderId } },
    { orgId: input.orgId, eventType: 'inventory.reserve', payload: { orgId: input.orgId, orderId } },
  ]);
  return { status: 'promoted', orderId };
}

async function insertOrder(
  tx: DbTx,
  orgId: string,
  candidateId: string,
  connectionId: string,
  candidate: CandidateOrder,
  sections: Sections,
): Promise<string> {
  const customerId = await findOrCreateCustomer(tx, orgId, connectionId, candidate);
  const seq = await nextDocumentNumber(tx, orgId, 'order');
  const [order] = await tx.insert(orders).values({
    ...orderValues(orgId, candidateId, connectionId, candidate, sections, customerId),
    orderNumber: formatDocumentNumber('order', seq),
  }).returning({ id: orders.id });
  if (!order) throw new Error('order promotion insert returned no row');
  return order.id;
}

function orderValues(
  orgId: string,
  candidateId: string,
  connectionId: string,
  c: CandidateOrder,
  sections: Sections,
  customerId: string | null,
) {
  const lifecycle = deriveLifecycles(c);
  return {
    orgId,
    status: lifecycle.legacyStatus,
    paymentMethod: isCod(c) ? 'cod' as const : 'online' as const,
    totalAmountMinor: BigInt(c.price.total),
    currency: c.currency.shop,
    customerId,
    importStatus: 'complete' as const,
    buyer: { name: c.buyer.name ?? null, email: c.buyer.email ?? null, phone: c.buyer.phone ?? null },
    billingAddress: addressSnapshot(c.addresses.billing),
    shippingAddress: addressSnapshot(c.addresses.shipping),
    subtotalMinor: BigInt(c.price.subtotal),
    discountMinor: BigInt(c.price.discounts),
    shippingMinor: BigInt(c.price.shipping),
    taxMinor: BigInt(c.header.total_tax_set.shop_money_minor),
    customerNote: c.context.note ?? null,
    connectionId,
    source: 'shopify',
    sourceOrderId: c.header.source_order_id,
    sourceOrderNumber: c.header.source_order_number ?? null,
    sourceCreatedAt: dateOrNull(c.header.source_created_at),
    sourceUpdatedAt: new Date(c.header.source_updated_at),
    sourceSyncedAt: new Date(c.evidence.fetched_at),
    acceptedCandidateId: candidateId,
    presentmentCurrency: c.currency.presentment ?? null,
    feesMinor: BigInt(c.price.additional_fees),
    refundedMinor: BigInt(c.price.refunded),
    outstandingMinor: BigInt(c.price.outstanding),
    taxesIncluded: c.price.taxes_included,
    sourceFinancialStatus: c.header.financial_status ?? null,
    sourceFulfillmentStatus: c.header.fulfillment_status ?? null,
    tags: c.context.tags,
    customAttributes: c.context.custom_attributes,
    risk: c.context.risk ?? null,
    sourceUrl: c.context.source_url ?? null,
    isTest: c.context.is_test,
    cancelReason: c.context.cancel_reason ?? null,
    cancelledAt: dateOrNull(c.header.cancelled_at),
    closedAt: dateOrNull(c.header.closed_at),
    sections,
    commercialStatus: lifecycle.commercial,
    fulfillmentStatus: lifecycle.fulfillment,
    paymentStatus: lifecycle.payment,
    // TODO(OR-10/DM): stamp legal_entity_id / brand_id / channel_id from the
    // connection once those dimension columns exist on orders.
  };
}

async function upsertOrderItems(tx: DbTx, orgId: string, orderId: string, lines: CandidateOrder['lines']): Promise<void> {
  // No delete of lines missing from this revision: Shopify keeps edited-away
  // lines (current_quantity 0), and a vanished line makes the deferred
  // count trigger fail the COMMIT rather than silently dropping an item.
  for (const line of lines) {
    const kind = line.mapping.state === 'custom_nonstock' ? 'custom_nonstock' as const : 'mapped' as const;
    const variantId = kind === 'mapped' ? line.mapping.variant_id : null;
    if (kind === 'mapped' && (line.mapping.state !== 'mapped' || !variantId)) {
      throw new Error(`line ${line.source_line_id} is not mapped; a blocked candidate cannot be promoted`);
    }
    const snapshot = {
      variantId,
      lineKind: kind,
      priceMinor: BigInt(line.unit_price_minor),
      title: line.title,
      variantTitle: line.variant_title ?? null,
      skuSnapshot: line.sku_snapshot ?? null,
      sourceVariantId: line.source_variant_id ?? null,
      sourceProductId: line.source_product_id ?? null,
      currentQuantity: line.current_quantity,
      unfulfilledQuantity: line.unfulfilled_quantity,
      refundableQuantity: line.refundable_quantity,
      discountMinor: BigInt(line.discount_minor),
      taxMinor: BigInt(line.tax_minor),
      totalMinor: BigInt(line.total_minor),
      requiresShipping: line.requires_shipping,
      customAttributes: line.custom_attributes,
      taxLines: line.tax_lines,
      discountAllocations: line.discount_allocations,
    };
    await tx.insert(orderItems)
      .values({ orgId, orderId, sourceLineId: line.source_line_id, quantity: line.quantity, ...snapshot })
      // quantity is the ORIGINAL ordered quantity and is never rewritten.
      .onConflictDoUpdate({
        target: [orderItems.orderId, orderItems.sourceLineId],
        targetWhere: sql`${orderItems.sourceLineId} IS NOT NULL`,
        set: { ...snapshot, updatedAt: new Date() },
      });
  }
}

/** Provider child records are appended / updated by source id, never deleted. */
async function upsertSourceChildren(tx: DbTx, orgId: string, orderId: string, c: CandidateOrder): Promise<void> {
  for (const t of c.transactions) {
    const row = {
      kind: t.kind,
      status: t.status,
      gateway: t.gateway ?? null,
      amountMinor: BigInt(t.amount_minor),
      currency: c.currency.shop,
      processedAt: dateOrNull(t.processed_at),
      raw: t,
    };
    await tx.insert(orderSourceTransactions).values({ orgId, orderId, sourceId: t.source_transaction_id, ...row })
      .onConflictDoUpdate({ target: [orderSourceTransactions.orderId, orderSourceTransactions.sourceId], set: row });
  }
  for (const r of c.refunds) {
    const row = { totalMinor: BigInt(r.total_refunded_minor) };
    await tx.insert(orderSourceRefunds)
      .values({ orgId, orderId, sourceId: r.source_refund_id, ...row, ...(r.created_at ? { createdAt: new Date(r.created_at) } : {}) })
      .onConflictDoUpdate({ target: [orderSourceRefunds.orderId, orderSourceRefunds.sourceId], set: row });
  }
  for (const f of c.fulfillments) {
    const row = { status: f.status ?? null, tracking: { company: f.tracking_company ?? null, numbers: f.tracking_numbers } };
    await tx.insert(orderSourceFulfillments)
      .values({ orgId, orderId, sourceId: f.source_fulfillment_id, ...row, ...(f.created_at ? { createdAt: new Date(f.created_at) } : {}) })
      .onConflictDoUpdate({ target: [orderSourceFulfillments.orderId, orderSourceFulfillments.sourceId], set: { ...row, updatedAt: new Date() } });
  }
}

/**
 * Guests get no customer row (the buyer snapshot on the order is enough).
 * A registered buyer is matched ONLY by the connection-scoped provider
 * customer id; email/phone are recorded as identities and surface through
 * suggestMerge for a person to decide — never auto-linked here.
 */
async function findOrCreateCustomer(tx: DbTx, orgId: string, connectionId: string, c: CandidateOrder): Promise<string | null> {
  const externalId = c.buyer.source_customer_id;
  if (c.buyer.is_guest || !externalId) return null;
  const key = { kind: 'shopify' as const, connectionId, externalId };
  // Two different orders of the same new customer can promote concurrently;
  // this lock makes the find-then-create below race-free.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer:${connectionId}:${externalId}`}))`);
  const existing = await findCustomerByIdentity(tx, orgId, key);
  if (existing) return existing;

  const [created] = await tx.insert(customers).values({
    orgId,
    name: c.buyer.name ?? 'Shopify customer',
    email: c.buyer.email ?? null,
    phone: c.buyer.phone ?? null,
  }).returning({ id: customers.id });
  if (!created) throw new Error('customer insert returned no row');
  await upsertIdentity(tx, orgId, { ...key, customerId: created.id, verified: true });
  if (c.buyer.email) await upsertIdentity(tx, orgId, { kind: 'email', connectionId, externalId: c.buyer.email, customerId: created.id });
  if (c.buyer.phone) await upsertIdentity(tx, orgId, { kind: 'phone', connectionId, externalId: c.buyer.phone, customerId: created.id });
  return created.id;
}

async function markPromoted(
  tx: DbTx,
  orgId: string,
  candidate: typeof orderImportCandidates.$inferSelect,
  orderId: string,
): Promise<void> {
  await tx.update(orderImportCandidates)
    .set({ status: 'promoted', promotedOrderId: orderId, lastError: null, updatedAt: new Date() })
    .where(and(eq(orderImportCandidates.id, candidate.id), eq(orderImportCandidates.orgId, orgId)));
  // Older, never-accepted versions are now moot. Earlier PROMOTED versions
  // keep 'promoted' as revision history (orders.accepted_candidate_id points
  // at the newest).
  await tx.update(orderImportCandidates)
    .set({ status: 'superseded', updatedAt: new Date() })
    .where(and(
      eq(orderImportCandidates.orgId, orgId),
      eq(orderImportCandidates.provider, candidate.provider),
      eq(orderImportCandidates.connectionId, candidate.connectionId!),
      eq(orderImportCandidates.sourceOrderId, candidate.sourceOrderId),
      ne(orderImportCandidates.id, candidate.id),
      lt(orderImportCandidates.sourceUpdatedAt, candidate.sourceUpdatedAt),
      inArray(orderImportCandidates.status, ['hydrating', 'blocked']),
    ));
}

async function supersede(tx: DbTx, orgId: string, candidateId: string, orderId: string | null, reason?: string): Promise<void> {
  await tx.update(orderImportCandidates)
    .set({ status: 'superseded', promotedOrderId: orderId, updatedAt: new Date(), ...(reason ? { lastError: reason } : {}) })
    .where(and(eq(orderImportCandidates.id, candidateId), eq(orderImportCandidates.orgId, orgId)));
}

function isCod(c: CandidateOrder): boolean {
  return c.context.custom_attributes.cod === 'true';
}

type PaymentLifecycle = 'pending' | 'cod_pending' | 'authorized' | 'paid' | 'partially_refunded' | 'refunded' | 'voided' | 'failed';

/** Exact Shopify display-status values; never substring matches ('UNFULFILLED' contains 'FULFILLED'). */
export function deriveLifecycles(c: CandidateOrder) {
  const financial = (c.header.financial_status ?? '').toUpperCase();
  const fulfillmentSrc = (c.header.fulfillment_status ?? '').toUpperCase();
  const cancelled = Boolean(c.header.cancelled_at);

  const paymentByFinancial: Record<string, PaymentLifecycle | undefined> = {
    PAID: 'paid',
    PARTIALLY_REFUNDED: 'partially_refunded',
    REFUNDED: 'refunded',
    AUTHORIZED: 'authorized',
    VOIDED: 'voided',
    EXPIRED: 'failed',
  };
  const payment: PaymentLifecycle = paymentByFinancial[financial] ?? (isCod(c) ? 'cod_pending' : 'pending');
  const fulfillment = fulfillmentSrc === 'FULFILLED' ? 'shipped' as const
    : fulfillmentSrc === 'PARTIALLY_FULFILLED' ? 'partial' as const
      : 'unfulfilled' as const;
  const commercial = cancelled ? 'cancelled' as const : c.header.closed_at ? 'closed' as const : 'open' as const;
  const legacyStatus = cancelled ? 'cancelled' as const
    : fulfillment === 'shipped' ? 'shipped' as const
      : payment === 'voided' || payment === 'failed' ? 'payment_failed' as const
        : payment === 'paid' || payment === 'partially_refunded' || payment === 'refunded' || payment === 'authorized' ? 'confirmed' as const
          : 'pending' as const;
  // settlement stays at its 'unsettled' default: a Shopify 'PAID' is not a payout.
  return { payment, fulfillment, commercial, legacyStatus };
}

function addressSnapshot(address: CandidateOrder['addresses']['shipping']) {
  if (!address) return null;
  return {
    name: address.name ?? null,
    phone: address.phone ?? null,
    address1: address.address1 ?? null,
    address2: address.address2 ?? null,
    city: address.city ?? null,
    province: address.province ?? null,
    zip: address.zip ?? null,
    country: address.country ?? null,
  };
}

function dateOrNull(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}
