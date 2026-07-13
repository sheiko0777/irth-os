import { pgTable, uuid, timestamp, text, numeric, pgEnum } from 'drizzle-orm/pg-core';

export const giftCardStatusEnum = pgEnum('gift_card_status', ['active', 'redeemed', 'expired', 'cancelled']);
export const giftCardTxTypeEnum = pgEnum('gift_card_tx_type', ['issue', 'redeem', 'topup', 'refund', 'expire', 'cancel']);

export const giftCards = pgTable('gift_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull(),
  code: text('code').notNull(),
  initialAmount: numeric('initial_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull().default('0'),
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
  orgId: text('org_id').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  txType: giftCardTxTypeEnum('tx_type').notNull(),
  orderId: uuid('order_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
