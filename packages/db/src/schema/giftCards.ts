import { pgTable, uuid, timestamp, text, bigint, pgEnum } from 'drizzle-orm/pg-core';

export const giftCardStatusEnum = pgEnum('gift_card_status', ['active', 'redeemed', 'expired', 'cancelled']);
export const giftCardTxTypeEnum = pgEnum('gift_card_tx_type', ['issue', 'redeem', 'topup', 'refund', 'expire', 'cancel']);

export const giftCards = pgTable('gift_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: text('code').notNull(),
  initialAmountMinor: bigint('initial_amount_minor', { mode: 'bigint' }).notNull().default(0n),
  // CHECK (balance_minor >= 0) in 0028: a gift card is a liability, and one
  // that can go negative is an unbounded one.
  balanceMinor: bigint('balance_minor', { mode: 'bigint' }).notNull().default(0n),
  currency: text('currency').notNull().default('EGP'),
  status: giftCardStatusEnum('status').notNull().default('active'),
  customerId: uuid('customer_id'),
  recipientName: text('recipient_name'),
  recipientEmail: text('recipient_email'),
  message: text('message'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const giftCardTransactions = pgTable('gift_card_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  giftCardId: uuid('gift_card_id').notNull().references(() => giftCards.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  txType: giftCardTxTypeEnum('tx_type').notNull(),
  orderId: uuid('order_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
