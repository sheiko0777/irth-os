import { pgTable, pgEnum, uuid, text, bigint, char, boolean, timestamp, date, uniqueIndex, unique, index, check, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../schema';
import { brands, channels, legalEntities, warehouses } from './dimensions';

/**
 * The double-entry ledger. See migration 0038 for the full rationale — in
 * particular why there is no separate `journals` table (a plain enum, matching
 * this codebase's convention for closed vocabularies). 0080 (DM-03) added the
 * legal entity, analytic dimensions and functional-currency amounts; the
 * balance trigger sums the functional columns.
 */

export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
export const ledgerNormalBalanceEnum = pgEnum('ledger_normal_balance', ['debit', 'credit']);
export const ledgerJournalTypeEnum = pgEnum('ledger_journal_type', ['sales', 'purchases', 'cash', 'inventory', 'general']);
export const ledgerPeriodStatusEnum = pgEnum('ledger_period_status', ['open', 'closed']);
export const ledgerEntryKindEnum = pgEnum('ledger_entry_kind', [
  'order_delivered', 'return_refund', 'return_restock',
  'gift_card_issued', 'gift_card_redeemed',
  'po_receipt', 'supplier_payment', 'courier_remittance',
  'rep_collection', 'rep_handover', 'rep_shortage_writeoff',
  'stocktake_variance', 'reversal', 'manual', 'intercompany', 'fx_revaluation',
]);
export const ledgerCounterpartyKindEnum = pgEnum('ledger_counterparty_kind', ['customer', 'supplier', 'courier', 'member', 'legal_entity']);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  // 0080: each legal entity has its own chart.
  legalEntityId: uuid('legal_entity_id').notNull(),
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
  unique('accounts_org_entity_code_key').on(table.orgId, table.legalEntityId, table.code),
  uniqueIndex('accounts_id_org_key').on(table.id, table.orgId),
  unique('accounts_id_entity_key').on(table.id, table.legalEntityId),
  foreignKey({ name: 'accounts_entity_same_org_fk', columns: [table.legalEntityId, table.orgId], foreignColumns: [legalEntities.id, legalEntities.orgId] }),
]);

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  legalEntityId: uuid('legal_entity_id').notNull(),
  journalType: ledgerJournalTypeEnum('journal_type').notNull(),
  // What business event this is. With source_table/source_id it makes a
  // double posting of one event unrepresentable (journal_entries_source_kind_once).
  entryKind: ledgerEntryKindEnum('entry_kind').notNull(),
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
  unique('journal_entries_id_entity_key').on(table.id, table.legalEntityId),
  index('journal_entries_org_date_idx').on(table.orgId, table.entryDate),
  index('journal_entries_org_source_idx').on(table.orgId, table.sourceTable, table.sourceId),
  uniqueIndex('journal_entries_source_kind_once')
    .on(table.orgId, table.legalEntityId, table.sourceTable, table.sourceId, table.entryKind)
    .where(sql`${table.reversalOf} IS NULL AND ${table.entryKind} NOT IN ('po_receipt', 'gift_card_redeemed', 'manual')`),
  foreignKey({ name: 'journal_entries_entity_same_org_fk', columns: [table.legalEntityId, table.orgId], foreignColumns: [legalEntities.id, legalEntities.orgId] }),
]);

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  legalEntityId: uuid('legal_entity_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  accountId: uuid('account_id').notNull(),
  debitMinor: bigint('debit_minor', { mode: 'bigint' }).notNull().default(0n),
  creditMinor: bigint('credit_minor', { mode: 'bigint' }).notNull().default(0n),
  currency: char('currency', { length: 3 }).notNull().default('EGP'),
  // The same amount in the entity's functional currency, and the rate used
  // (1 `currency` = fxRateNum/fxRateDen `functionalCurrency`). The balance
  // trigger sums these.
  functionalCurrency: char('functional_currency', { length: 3 }).notNull(),
  functionalDebitMinor: bigint('functional_debit_minor', { mode: 'bigint' }).notNull(),
  functionalCreditMinor: bigint('functional_credit_minor', { mode: 'bigint' }).notNull(),
  fxRateNum: bigint('fx_rate_num', { mode: 'bigint' }).notNull(),
  fxRateDen: bigint('fx_rate_den', { mode: 'bigint' }).notNull(),
  // Analytic dimensions. variant/order carry no FK, like source_id.
  brandId: uuid('brand_id'),
  channelId: uuid('channel_id'),
  warehouseId: uuid('warehouse_id'),
  variantId: uuid('variant_id'),
  orderId: uuid('order_id'),
  counterpartyKind: ledgerCounterpartyKindEnum('counterparty_kind'),
  // text: a 'member' counterparty is a Better Auth user id.
  counterpartyId: text('counterparty_id'),
  memo: text('memo'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('journal_lines_entry_idx').on(table.entryId),
  index('journal_lines_org_account_idx').on(table.orgId, table.accountId),
  index('journal_lines_org_entity_account_idx').on(table.orgId, table.legalEntityId, table.accountId),
  foreignKey({ name: 'journal_lines_entry_org_fkey', columns: [table.entryId, table.orgId], foreignColumns: [journalEntries.id, journalEntries.orgId] }),
  foreignKey({ name: 'journal_lines_account_org_fkey', columns: [table.accountId, table.orgId], foreignColumns: [accounts.id, accounts.orgId] }),
  foreignKey({ name: 'journal_lines_entry_entity_fkey', columns: [table.entryId, table.legalEntityId], foreignColumns: [journalEntries.id, journalEntries.legalEntityId] }),
  foreignKey({ name: 'journal_lines_account_entity_fkey', columns: [table.accountId, table.legalEntityId], foreignColumns: [accounts.id, accounts.legalEntityId] }),
  foreignKey({ name: 'journal_lines_brand_same_org_fk', columns: [table.brandId, table.orgId], foreignColumns: [brands.id, brands.orgId] }),
  foreignKey({ name: 'journal_lines_channel_same_org_fk', columns: [table.channelId, table.orgId], foreignColumns: [channels.id, channels.orgId] }),
  foreignKey({ name: 'journal_lines_warehouse_same_org_fk', columns: [table.warehouseId, table.orgId], foreignColumns: [warehouses.id, warehouses.orgId] }),
  // A line is a debit line XOR a credit line — mirrors the DB-level CHECK in
  // 0038, stated here too so Drizzle's own type/introspection tooling and
  // anyone reading this file see the invariant without opening the SQL.
  check('journal_lines_side_check', sql`${table.debitMinor} >= 0 AND ${table.creditMinor} >= 0 AND ((${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0))`),
  // 0080: the same rule on the functional pair, both pairs on the same side.
  check('journal_lines_functional_side_check', sql`${table.functionalDebitMinor} >= 0 AND ${table.functionalCreditMinor} >= 0 AND ((${table.functionalDebitMinor} > 0 AND ${table.functionalCreditMinor} = 0) OR (${table.functionalCreditMinor} > 0 AND ${table.functionalDebitMinor} = 0)) AND (${table.debitMinor} > 0) = (${table.functionalDebitMinor} > 0)`),
  check('journal_lines_fx_rate_positive_check', sql`${table.fxRateNum} > 0 AND ${table.fxRateDen} > 0`),
  check('journal_lines_counterparty_pair_check', sql`(${table.counterpartyKind} IS NULL) = (${table.counterpartyId} IS NULL)`),
]);

export const fiscalPeriods = pgTable('fiscal_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  // 0080: a period closes for one entity.
  legalEntityId: uuid('legal_entity_id').notNull(),
  startDate: date('start_date', { mode: 'date' }).notNull(),
  endDate: date('end_date', { mode: 'date' }).notNull(),
  status: ledgerPeriodStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('fiscal_periods_org_dates_idx').on(table.orgId, table.startDate, table.endDate),
  index('fiscal_periods_org_entity_dates_idx').on(table.orgId, table.legalEntityId, table.startDate, table.endDate),
  foreignKey({ name: 'fiscal_periods_entity_same_org_fk', columns: [table.legalEntityId, table.orgId], foreignColumns: [legalEntities.id, legalEntities.orgId] }),
  check('fiscal_periods_dates_check', sql`${table.endDate} >= ${table.startDate}`),
]);
