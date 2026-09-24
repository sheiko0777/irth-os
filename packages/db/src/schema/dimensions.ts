import { pgTable, pgEnum, uuid, text, char, boolean, jsonb, timestamp, unique, foreignKey } from 'drizzle-orm/pg-core';
import { organizations } from '../schema';

// Mirrors migration 0069. Every table has UNIQUE (id, org_id) so children can
// use a composite (x_id, org_id) FK: a row pointing at another org's dimension
// is unrepresentable.

export const legalEntityKindEnum = pgEnum('legal_entity_kind', ['operating', 'elimination']);
export const recognitionPointEnum = pgEnum('recognition_point', ['delivered', 'shipped', 'paid', 'invoiced']);
export const channelKindEnum = pgEnum('channel_kind', ['shopify', 'woocommerce', 'pos', 'whatsapp', 'b2b', 'marketplace']);

export const legalEntities = pgTable('legal_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  kind: legalEntityKindEnum('kind').notNull().default('operating'),
  functionalCurrency: char('functional_currency', { length: 3 }).notNull().default('EGP'),
  documentPrefix: text('document_prefix').notNull(),
  recognitionPoint: recognitionPointEnum('recognition_point').notNull().default('delivered'),
  taxRegistrationNo: text('tax_registration_no'),
  country: char('country', { length: 2 }).notNull().default('EG'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('legal_entities_org_code_uq').on(t.orgId, t.code),
  unique('legal_entities_id_org_uq').on(t.id, t.orgId),
]);

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('brands_org_code_uq').on(t.orgId, t.code),
  unique('brands_id_org_uq').on(t.id, t.orgId),
]);

// Physical location only — legal ownership of stock lives on the stock
// position, never on the warehouse.
export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  address: jsonb('address'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('warehouses_org_code_uq').on(t.orgId, t.code),
  unique('warehouses_id_org_uq').on(t.id, t.orgId),
]);

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: channelKindEnum('kind').notNull(),
  brandId: uuid('brand_id').notNull(),
  sellingEntityId: uuid('selling_entity_id').notNull(),
  defaultWarehouseId: uuid('default_warehouse_id'),
  currency: char('currency', { length: 3 }).notNull().default('EGP'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('channels_org_code_uq').on(t.orgId, t.code),
  unique('channels_id_org_uq').on(t.id, t.orgId),
  foreignKey({ name: 'channels_brand_same_org_fk', columns: [t.brandId, t.orgId], foreignColumns: [brands.id, brands.orgId] }),
  foreignKey({ name: 'channels_entity_same_org_fk', columns: [t.sellingEntityId, t.orgId], foreignColumns: [legalEntities.id, legalEntities.orgId] }),
  foreignKey({ name: 'channels_warehouse_same_org_fk', columns: [t.defaultWarehouseId, t.orgId], foreignColumns: [warehouses.id, warehouses.orgId] }),
]);
