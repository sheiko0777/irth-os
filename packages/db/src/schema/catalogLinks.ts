import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations, productVariants } from '../schema';
import { shopifyConnections } from './shopify';

// Mirrors migration 0088 (OR-07): which provider variant is which local
// variant, per connection. Links are made by explicit operator action or the
// 0088 backfill — never by SKU equality. The RLS policy lives in the migration.

export const VARIANT_LINK_STATES = ['active', 'pending_custom', 'deleted'] as const;
export type VariantLinkState = (typeof VARIANT_LINK_STATES)[number];

export const VARIANT_LINK_LINE_KINDS = ['mapped', 'custom_nonstock'] as const;
export type VariantLinkLineKind = (typeof VARIANT_LINK_LINE_KINDS)[number];

export const variantSourceLinks = pgTable('variant_source_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  // CX-12 repoints this to the composite connections(id, org_id).
  connectionId: uuid('connection_id').notNull().references(() => shopifyConnections.id),
  provider: text('provider').notNull().default('shopify'),
  sourceVariantId: text('source_variant_id').notNull(),
  sourceProductId: text('source_product_id'),
  sourceInventoryItemId: text('source_inventory_item_id'),
  // NULL exactly when lineKind is custom_nonstock or state is pending_custom.
  variantId: uuid('variant_id'),
  lineKind: text('line_kind').notNull().default('mapped').$type<VariantLinkLineKind>(),
  state: text('state').notNull().default('active').$type<VariantLinkState>(),
  skuSnapshot: text('sku_snapshot'),
  titleSnapshot: text('title_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: 'variant_source_links_variant_same_org_fk',
    columns: [t.variantId, t.orgId],
    foreignColumns: [productVariants.id, productVariants.orgId],
  }),
  unique('variant_source_links_source_key').on(t.provider, t.connectionId, t.sourceVariantId),
  index('variant_source_links_org_variant_idx').on(t.orgId, t.variantId),
  index('variant_source_links_inventory_item_idx').on(t.connectionId, t.sourceInventoryItemId),
  check('variant_source_links_provider_check', sql`${t.provider} ~ '^[a-z][a-z0-9_]{1,40}$'`),
  check('variant_source_links_source_variant_id_check', sql`length(btrim(${t.sourceVariantId})) > 0`),
  check('variant_source_links_line_kind_check', sql`${t.lineKind} IN ('mapped', 'custom_nonstock')`),
  check('variant_source_links_state_check', sql`${t.state} IN ('active', 'pending_custom', 'deleted')`),
  check('variant_source_links_variant_presence_check',
    sql`(${t.variantId} IS NULL) = (${t.lineKind} = 'custom_nonstock' OR ${t.state} = 'pending_custom')`),
]);
