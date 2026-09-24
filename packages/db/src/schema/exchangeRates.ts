import { pgTable, pgEnum, uuid, char, bigint, date, text, timestamp, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../schema';

// Mirrors migration 0070. 1 `base` = rateNum/rateDen `quote` on `asOf`.
export const fxRateSourceEnum = pgEnum('fx_rate_source', ['ecb', 'cbe', 'manual']);

export const exchangeRates = pgTable('exchange_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  base: char('base', { length: 3 }).notNull(),
  quote: char('quote', { length: 3 }).notNull(),
  rateNum: bigint('rate_num', { mode: 'bigint' }).notNull(),
  rateDen: bigint('rate_den', { mode: 'bigint' }).notNull(),
  asOf: date('as_of').notNull(),
  source: fxRateSourceEnum('source').notNull(),
  approvedBy: text('approved_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('exchange_rates_org_pair_date_uq').on(t.orgId, t.base, t.quote, t.asOf),
  check('exchange_rates_positive_ck', sql`${t.rateNum} > 0 AND ${t.rateDen} > 0`),
  check('exchange_rates_distinct_pair_ck', sql`${t.base} <> ${t.quote}`),
]);
