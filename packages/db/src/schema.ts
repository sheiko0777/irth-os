// Money is bigint minor units (piastres), never decimal — see CLAUDE.md rule 1.
// `mode: 'bigint'` makes Drizzle hand back a JS bigint rather than a string, so
// values flow straight into @irth/domain's Money without a lossy hop through
// Number on the way.
import { pgTable, uuid, timestamp, varchar, text, jsonb, bigint, char, boolean, integer, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";

export const brandEnum = pgEnum('brand', ['irth']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'confirmed', 'payment_failed', 'shipped', 'delivered', 'cancelled']);
export const shippingProviderEnum = pgEnum('shipping_provider', ['bosta', 'mylerz']);

// Base columns for all tables with org_id rule
const baseColumns = {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brand: brandEnum("brand").notNull().default("irth"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMembers = pgTable("org_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // The exact column both org-context resolvers filter on (packages/db/src/
  // orgContext.ts) had no index at all until migration 0043.
  userIdIdx: index('org_members_user_id_idx').on(table.userId),
  orgUserUniqueIdx: uniqueIndex('org_members_org_id_user_id_idx').on(table.orgId, table.userId),
}));

export const orgInvites = pgTable("org_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("member"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  categoryId: uuid('category_id').references(() => categories.id),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  // Dashboard owns the catalog; this is the Shopify counterpart's GID once
  // pushed. NULL until first sync — see migration 0041.
  shopifyProductId: text('shopify_product_id'),
  // Unique per ORG, not globally — see the table-level index below and
  // migration 0040. A bare .unique() meant the first tenant to register a SKU
  // blocked every other tenant from ever using that code.
  sku: text('sku').notNull(),
  description: text('description'),
  descriptionAr: text('description_ar'),
  priceMinor: bigint('price_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull().default('EGP'),
  stock: integer('stock').notNull().default(0),
  status: text('status').notNull().default('active'), // 'active' | 'draft' | 'archived'
  images: jsonb('images').default([]),
  brand: brandEnum('brand').default('irth').notNull(), // Keeping brand to not break existing tests/code without need, or maybe we drop it? The spec didn't mention it. I will keep it for safety unless told otherwise. Actually I will just keep it since it's an enum we have.
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  orgSkuIdx: uniqueIndex('products_org_id_sku_idx').on(table.orgId, table.sku),
  orgShopifyProductIdIdx: uniqueIndex('products_org_id_shopify_product_id_idx').on(table.orgId, table.shopifyProductId),
}));

export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Migration 0027 added org_id as uuid NOT NULL with no default, but this
  // table never declared it. Drizzle omits columns it does not know about, so
  // every variant insert was rejected with 23502 — proven against a real
  // branch, and invisible to the mocked unit suite.
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  name: text('name').notNull(),
  // Shopify counterpart's GID once pushed — see migration 0041.
  shopifyVariantId: text('shopify_variant_id'),
  // Shopify's own inventory-item GID, distinct from the variant GID — its
  // inventory_levels/update webhook keys by this, not by variant id.
  shopifyInventoryItemId: text('shopify_inventory_item_id'),
  // Unique per ORG, not globally — see the table-level index below and
  // migration 0040.
  sku: text('sku').notNull(),
  // Nullable: a variant with no price of its own inherits the product's. This
  // was NOT NULL in migration 0000 but nullable here — 0028 settles the drift
  // on the behaviour the admin already assumes.
  priceMinor: bigint('price_minor', { mode: 'bigint' }),
  stock: integer('stock').notNull().default(0),
  attributes: jsonb('attributes').default({}),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  orgSkuIdx: uniqueIndex('product_variants_org_id_sku_idx').on(table.orgId, table.sku),
  orgShopifyVariantIdIdx: uniqueIndex('product_variants_org_id_shopify_variant_id_idx').on(table.orgId, table.shopifyVariantId),
  orgShopifyInventoryItemIdIdx: uniqueIndex('product_variants_org_id_shopify_inventory_item_id_idx').on(table.orgId, table.shopifyInventoryItemId),
}));

export const orders = pgTable("orders", {
  ...baseColumns,
  // Unique per ORG, not globally — see the table-level constraint below and
  // migration 0035. A bare .unique() here meant the second org ever to place
  // an order collided with the first org's IRT-2026-0001 and could not order.
  orderNumber: varchar("order_number", { length: 50 }).notNull(), // IRT-2026-0001
  status: orderStatusEnum("status").notNull().default('pending'),
  totalAmountMinor: bigint("total_amount_minor", { mode: 'bigint' }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default('EGP'),
  // NOT a user id. This is uuid, while Better Auth user ids are text — see
  // 0034. apps/api was writing the session's userId straight in here, which
  // raised 22P02 and meant order creation through the API could never succeed.
  // It refers to `customers.id` when a customer is linked, and is NULL when the
  // order has no customer record yet.
  customerId: uuid("customer_id"),
  // Set only for orders that originated on the Shopify storefront (inbound
  // webhook). NULL for orders placed through the dashboard itself — see
  // migration 0041.
  shopifyOrderId: text("shopify_order_id"),
}, (table) => ({
  // Per tenant, not global (0035). A bare .unique() on order_number meant the
  // second org ever to place an order collided with the first org's
  // IRT-2026-0001 and was locked out of ordering entirely.
  orgOrderNumberIdx: uniqueIndex('orders_org_order_number_idx').on(table.orgId, table.orderNumber),
  orgShopifyOrderIdIdx: uniqueIndex('orders_org_id_shopify_order_id_idx').on(table.orgId, table.shopifyOrderId),
}));

export const orderItems = pgTable("order_items", {
  ...baseColumns,
  orderId: uuid("order_id").references(() => orders.id).notNull(),
  variantId: uuid("variant_id").references(() => productVariants.id).notNull(),
  quantity: integer("quantity").notNull(),
  // No currency column: a line is denominated in its order's currency by
  // definition, and a second copy is a second thing that can disagree.
  priceMinor: bigint("price_minor", { mode: 'bigint' }).notNull(),
  // Cost basis captured when stock was decremented for this line (0039). NULL
  // means the item had no cost basis yet — unknown, not free; the
  // order-delivered ledger posting reports the gap rather than treating it
  // as zero COGS.
  costMinor: bigint("cost_minor", { mode: 'bigint' }),
});

export const shipmentTracking = pgTable("shipment_tracking", {
  ...baseColumns,
  orderId: uuid("order_id").references(() => orders.id).notNull(),
  provider: shippingProviderEnum("provider").notNull(),
  trackingNumber: varchar("tracking_number", { length: 255 }),
  status: varchar("status", { length: 100 }), // The provider's status, mapped later to order status
  rawPayload: jsonb("raw_payload").default({}),
});

export const auditLog = pgTable("audit_log", {
  ...baseColumns,
  // TEXT, not uuid (0034). Better Auth owns `public."user"` and its ids are
  // random alphanumeric strings, not uuids — writing one into a uuid column
  // raised 22P02 on every audited mutation by a logged-in user.
  // org_members.user_id is text for the same reason.
  userId: text("user_id"),
  action: varchar("action", { length: 255 }).notNull(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  // Nullable since 0033: some audited actions (bulk updates) have no single
  // subject row, and the previous NOT NULL forced withAudit to invent one.
  recordId: uuid("record_id"),
  changes: jsonb("changes").notNull(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull(),
  type: text('type').notNull(), // 'invite_accepted' | 'member_joined' | 'order_status' | 'system'
  title: text('title').notNull(),
  body: text('body'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
});
