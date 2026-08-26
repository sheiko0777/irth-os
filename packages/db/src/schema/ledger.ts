import { pgTable, pgEnum, uuid, text, bigint, char, boolean, timestamp, date, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../schema';

/**
 * The double-entry ledger. See migration 0038 for the full rationale — in
 * particular why there is no separate `journals` table (a plain enum, matching
 * this codebase's convention for closed vocabularies) and why
 * exchange_rates/tax_codes/tax_rates are not built (nothing reads or writes
 * them; EGYPT_VAT_BP is the only rate this system currently applies).
 */

export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
export const ledgerNormalBalanceEnum = pgEnum('ledger_normal_balance', ['debit', 'credit']);
export const ledgerJournalTypeEnum = pgEnum('ledger_journal_type', ['sales', 'purchases', 'cash', 'inventory', 'general']);
export const ledgerPeriodStatusEnum = pgEnum('ledger_period_status', ['open', 'closed']);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: ledgerAccountTypeEnum('type').notNull(),
  // Explicit, not derived from `type` — a contra account (Sales Returns is
  // type=revenue but normal_balance=debit) cannot be expressed otherwise.
  normalBalance: ledgerNormalBalanceEnum('normal_balance').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('accounts_org_code_key').on(table.orgId, table.code),
  uniqueIndex('accounts_id_org_key').on(table.id, table.orgId),
]);

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  journalType: ledgerJournalTypeEnum('journal_type').notNull(),
  entryDate: timestamp('entry_date').notNull().defaultNow(),
  description: text('description').notNull(),
  // Polymorphic reference to the business row this entry describes. No FK —
  // the referenced table varies and the entry must outlive the source row's
  // own lifecycle. Traceability, not a join target.
  sourceTable: text('source_table'),
  sourceId: uuid('source_id'),
  reversalOf: uuid('reversal_of'),
  // text, not uuid — Better Auth user ids are not uuids (0034).
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('journal_entries_id_org_key').on(table.id, table.orgId),
  index('journal_entries_org_date_idx').on(table.orgId, table.entryDate),
  index('journal_entries_org_source_idx').on(table.orgId, table.sourceTable, table.sourceId),
]);

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  entryId: uuid('entry_id').notNull(),
  accountId: uuid('account_id').notNull(),
  debitMinor: bigint('debit_minor', { mode: 'bigint' }).notNull().default(0n),
  creditMinor: bigint('credit_minor', { mode: 'bigint' }).notNull().default(0n),
  currency: char('currency', { length: 3 }).notNull().default('EGP'),
  memo: text('memo'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('journal_lines_entry_idx').on(table.entryId),
  index('journal_lines_org_account_idx').on(table.orgId, table.accountId),
  // A line is a debit line XOR a credit line — mirrors the DB-level CHECK in
  // 0038, stated here too so Drizzle's own type/introspection tooling and
  // anyone reading this file see the invariant without opening the SQL.
  check('journal_lines_side_check', sql`${table.debitMinor} >= 0 AND ${table.creditMinor} >= 0 AND ((${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0))`),
]);

export const fiscalPeriods = pgTable('fiscal_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  startDate: date('start_date', { mode: 'date' }).notNull(),
  endDate: date('end_date', { mode: 'date' }).notNull(),
  status: ledgerPeriodStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('fiscal_periods_org_dates_idx').on(table.orgId, table.startDate, table.endDate),
]);
