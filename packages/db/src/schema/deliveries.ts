import { pgTable, uuid, text, timestamp, bigint, char, unique, index, check, varchar, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../schema';

// Mirrors migration 0077 (PR-2a). The composite same-org FKs to orders,
// org_members and rep_cash_handovers, the handover-once trigger and the
// delivery-rep RLS policies live in the migration.

export const DELIVERY_OUTCOMES = ['delivered', 'failed', 'returned'] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** Append-only: every delivery, failed attempt and return a rep reports. */
export const deliveryAttempts = pgTable('delivery_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  orderId: uuid('order_id').notNull(),
  memberId: uuid('member_id').notNull(),
  outcome: text('outcome').$type<DeliveryOutcome>().notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('delivery_attempts_org_order_idx').on(t.orgId, t.orderId),
  check('delivery_attempts_outcome_check', sql`${t.outcome} IN ('delivered', 'failed', 'returned')`),
  check('delivery_attempts_reason_length_check', sql`${t.reason} IS NULL OR length(${t.reason}) <= 500`),
]);

/** The cash a rep brings back at the end of a shift, and what was counted. */
export const repCashHandovers = pgTable('rep_cash_handovers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  memberId: uuid('member_id').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  declaredMinor: bigint('declared_minor', { mode: 'bigint' }).notNull(),
  expectedMinor: bigint('expected_minor', { mode: 'bigint' }).notNull(),
  receivedMinor: bigint('received_minor', { mode: 'bigint' }),
  writtenOffMinor: bigint('written_off_minor', { mode: 'bigint' }),
  status: text('status').$type<'submitted' | 'confirmed'>().notNull().default('submitted'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at'),
  writtenOffBy: text('written_off_by'),
  writtenOffAt: timestamp('written_off_at'),
}, (t) => [
  unique('rep_cash_handovers_id_org_id_key').on(t.id, t.orgId),
  index('rep_cash_handovers_org_member_idx').on(t.orgId, t.memberId),
  check('rep_cash_handovers_status_check', sql`${t.status} IN ('submitted', 'confirmed')`),
]);

/** One per order, ever (UNIQUE org_id, order_id). Joins one handover and never leaves it. */
export const repCashCollections = pgTable('rep_cash_collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  memberId: uuid('member_id').notNull(),
  orderId: uuid('order_id').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  handoverId: uuid('handover_id'),
  collectedAt: timestamp('collected_at').defaultNow().notNull(),
}, (t) => [
  unique('rep_cash_collections_org_order_uq').on(t.orgId, t.orderId),
  check('rep_cash_collections_amount_check', sql`${t.amountMinor} > 0`),
]);

// ---------------------------------------------------------------------------
// Sales reps (0078, PR-2b). Quotes live here beside the delivery tables: both
// are a rep's own work, narrowed by the same member-id settings.
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = ['open', 'converted', 'cancelled'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** A priced proposal. Moves no stock and posts nothing until it becomes an order. */
export const salesQuotes = pgTable('sales_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  quoteNumber: varchar('quote_number', { length: 50 }).notNull(),
  customerId: uuid('customer_id').notNull(),
  createdByMemberId: uuid('created_by_member_id'),
  priceListId: uuid('price_list_id'),
  currency: char('currency', { length: 3 }).notNull(),
  subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
  discountMinor: bigint('discount_minor', { mode: 'bigint' }).notNull(),
  totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
  status: text('status').$type<QuoteStatus>().notNull().default('open'),
  validUntil: timestamp('valid_until').notNull(),
  convertedOrderId: uuid('converted_order_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('sales_quotes_id_org_id_key').on(t.id, t.orgId),
  unique('sales_quotes_org_number_uq').on(t.orgId, t.quoteNumber),
  index('sales_quotes_org_created_by_idx').on(t.orgId, t.createdByMemberId),
  check('sales_quotes_status_check', sql`${t.status} IN ('open', 'converted', 'cancelled')`),
]);

export const salesQuoteItems = pgTable('sales_quote_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  quoteId: uuid('quote_id').notNull(),
  variantId: uuid('variant_id').notNull(),
  quantity: integer('quantity').notNull(),
  listPriceMinor: bigint('list_price_minor', { mode: 'bigint' }).notNull(),
  unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
}, (t) => [
  index('sales_quote_items_org_quote_idx').on(t.orgId, t.quoteId),
]);
