// Money is bigint minor units (piastres), never decimal — see CLAUDE.md rule 1.
// `mode: 'bigint'` makes Drizzle hand back a JS bigint rather than a string, so
// values flow straight into @irth/domain's Money without a lossy hop through
// Number on the way.
import { pgTable, uuid, timestamp, varchar, text, jsonb, bigint, char, boolean, integer, pgEnum, uniqueIndex, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orderStatusEnum = pgEnum('order_status', ['pending', 'confirmed', 'payment_failed', 'shipped', 'delivered', 'cancelled']);
export const shippingProviderEnum = pgEnum('shipping_provider', ['bosta', 'mylerz']);
export const paymentMethodEnum = pgEnum('payment_method', ['cod', 'online']);

// 0086: the five order lifecycles (orders.<key>_status). The CHECK constraints
// in the migration hold the same lists; change both together.
export const ORDER_LIFECYCLES = {
  commercial: ['open', 'cancelled', 'closed'],
  fulfillment: ['unfulfilled', 'partial', 'shipped', 'delivered', 'returned'],
  payment: ['pending', 'cod_pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'voided', 'failed'],
  invoice: ['not_required', 'pending', 'issued', 'failed'],
  settlement: ['unsettled', 'partial', 'settled'],
} as const;
export type OrderLifecycle = keyof typeof ORDER_LIFECYCLES;
export type OrderLifecycleValue<L extends OrderLifecycle> = (typeof ORDER_LIFECYCLES)[L][number];
export const ORDER_LINE_KINDS = ['mapped', 'custom_nonstock'] as const;
export type OrderLineKind = (typeof ORDER_LINE_KINDS)[number];

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
  // 0069. Default dimensions are created by a DB trigger on insert, which also
  // sets stock_owner_entity_id; nullable only for that instant. FK to
  // legal_entities(id, org_id) lives in the migration (not declared here to
  // avoid a schema.ts <-> dimensions.ts import cycle).
  presentationCurrency: char("presentation_currency", { length: 3 }).notNull().default("EGP"),
  stockOwnerEntityId: uuid("stock_owner_entity_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMembers = pgTable("org_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").defaultNow(),
  // 0074 (owner decision A5). Not yet read for authorization — role above is
  // still the authority, and a trigger keeps accessRoleId pointing at the
  // org's system role for it. FK (access_role_id, org_id) -> access_roles is
  // in the migration (schema/access.ts imports this file).
  accessRoleId: uuid("access_role_id"),
  principalKind: text("principal_kind").$type<'staff' | 'delivery_rep' | 'sales_rep' | 'supplier'>().notNull().default('staff'),
  status: text("status").$type<'active' | 'suspended'>().notNull().default('active'),
  overrides: jsonb("overrides").$type<{ grant?: Record<string, string[]>; revoke?: Record<string, string[]> }>().notNull().default({ grant: {}, revoke: {} }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
}, (table) => ({
  // The exact column both org-context resolvers filter on (packages/db/src/
  // orgContext.ts) had no index at all until migration 0043.
  userIdIdx: index('org_members_user_id_idx').on(table.userId),
  orgUserUniqueIdx: uniqueIndex('org_members_org_id_user_id_idx').on(table.orgId, table.userId),
  accessRoleIdx: index('org_members_access_role_id_idx').on(table.accessRoleId),
  idOrgUq: unique('org_members_id_org_uq').on(table.id, table.orgId),
  principalKindCheck: check('org_members_principal_kind_check', sql`${table.principalKind} IN ('staff', 'delivery_rep', 'sales_rep', 'supplier')`),
  statusCheck: check('org_members_status_check', sql`${table.status} IN ('active', 'suspended')`),
}));

export const orgInvites = pgTable("org_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("member"),
  expiresAt: timestamp("expires_at").notNull(),
  // NULL = pre-OTP invite (migration 0046 added these nullable, no backfill —
  // see acceptOrgInvite in packages/db/src/invites.ts for how NULL is treated).
  otpCode: text("otp_code"),
  otpExpiresAt: timestamp("otp_expires_at"),
  otpAttempts: integer("otp_attempts").notNull().default(0),
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
  // 0069: FK (brand_id, org_id) -> brands(id, org_id) in the migration.
  // Nullable: shared ingredients/packaging belong to no brand.
  brandId: uuid('brand_id'),
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

export interface OrderBuyerSnapshot {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface OrderAddressSnapshot {
  name: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
}

export const orders = pgTable("orders", {
  ...baseColumns,
  // Unique per ORG, not globally — see the table-level constraint below and
  // migration 0035. A bare .unique() here meant the second org ever to place
  // an order collided with the first org's IRT-2026-0001 and could not order.
  orderNumber: varchar("order_number", { length: 50 }).notNull(), // IRT-2026-0001
  status: orderStatusEnum("status").notNull().default('pending'),
  paymentMethod: paymentMethodEnum("payment_method"),
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
  // 0073. 'blocked' = the provider sent lines this org could not map to a
  // variant, so no items were written and no stock moved. A blocked order
  // cannot advance except to 'cancelled' (transitionOrderStatus). Never a
  // partial import: either every line is on the order or none is.
  importStatus: text("import_status").notNull().default('complete'),
  blockedReason: text("blocked_reason"),
  // The provider's order as received, so a blocked order can be re-imported
  // once its lines are mapped. NULL for dashboard-created orders.
  sourcePayload: jsonb("source_payload"),
  // Snapshots at order time. NULL = not captured (pre-0073 rows), not empty.
  buyer: jsonb("buyer").$type<OrderBuyerSnapshot>(),
  shippingAddress: jsonb("shipping_address").$type<OrderAddressSnapshot>(),
  billingAddress: jsonb("billing_address").$type<OrderAddressSnapshot>(),
  subtotalMinor: bigint("subtotal_minor", { mode: 'bigint' }),
  discountMinor: bigint("discount_minor", { mode: 'bigint' }),
  shippingMinor: bigint("shipping_minor", { mode: 'bigint' }),
  taxMinor: bigint("tax_minor", { mode: 'bigint' }),
  customerNote: text("customer_note"),
  // 0077. The delivery rep (org_members.id) this order is assigned to. The
  // composite same-org FK lives in the migration; a rep sees only these rows
  // (orders_delivery_rep_scope).
  assignedRepMemberId: uuid("assigned_rep_member_id"),
  // 0078. The member who placed this order in the dashboard (a sales rep
  // placing it for their customer, or staff). NULL for storefront and API
  // orders. A sales rep sees the orders they placed and their customers'.
  createdByMemberId: uuid("created_by_member_id"),
  // 0086 (orders v2, DM-05 ⊕ OR-09). FKs on connection_id (shopify_connections)
  // and the two candidate ids (same-org onto order_import_candidates) live in
  // the migration, not here, to avoid a schema.ts <-> schema/* import cycle.
  // source: NULL = dashboard; 'legacy_shopify' = pre-candidate webhook import;
  // any other value requires accepted_candidate_id (orders_promotion_guard_check).
  connectionId: uuid("connection_id"),
  source: text("source"),
  sourceOrderId: text("source_order_id"),
  sourceOrderNumber: text("source_order_number"),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  sourceSyncedAt: timestamp("source_synced_at", { withTimezone: true }),
  acceptedCandidateId: uuid("accepted_candidate_id"),
  pendingRevisionCandidateId: uuid("pending_revision_candidate_id"),
  presentmentCurrency: char("presentment_currency", { length: 3 }),
  feesMinor: bigint("fees_minor", { mode: 'bigint' }),
  refundedMinor: bigint("refunded_minor", { mode: 'bigint' }),
  outstandingMinor: bigint("outstanding_minor", { mode: 'bigint' }),
  taxesIncluded: boolean("taxes_included"),
  sourceFinancialStatus: text("source_financial_status"),
  sourceFulfillmentStatus: text("source_fulfillment_status"),
  tags: text("tags").array(),
  customAttributes: jsonb("custom_attributes"),
  risk: jsonb("risk"),
  sourceUrl: text("source_url"),
  isTest: boolean("is_test").notNull().default(false),
  cancelReason: text("cancel_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // Must hold all 11 ORDER_SECTION keys when set (orders_sections_check).
  sections: jsonb("sections").$type<Record<string, unknown>>(),
  holdReason: text("hold_reason"),
  heldAt: timestamp("held_at", { withTimezone: true }),
  heldBy: text("held_by"),
  commercialStatus: text("commercial_status").notNull().default('open').$type<OrderLifecycleValue<'commercial'>>(),
  fulfillmentStatus: text("fulfillment_status").notNull().default('unfulfilled').$type<OrderLifecycleValue<'fulfillment'>>(),
  paymentStatus: text("payment_status").notNull().default('pending').$type<OrderLifecycleValue<'payment'>>(),
  invoiceStatus: text("invoice_status").notNull().default('not_required').$type<OrderLifecycleValue<'invoice'>>(),
  settlementStatus: text("settlement_status").notNull().default('unsettled').$type<OrderLifecycleValue<'settlement'>>(),
}, (table) => ({
  importStatusCheck: check('orders_import_status_check', sql`${table.importStatus} IN ('complete', 'blocked')`),
  orgBlockedIdx: index('orders_org_id_blocked_idx').on(table.orgId).where(sql`${table.importStatus} = 'blocked'`),
  // Per tenant, not global (0035). A bare .unique() on order_number meant the
  // second org ever to place an order collided with the first org's
  // IRT-2026-0001 and was locked out of ordering entirely.
  orgOrderNumberIdx: uniqueIndex('orders_org_order_number_idx').on(table.orgId, table.orderNumber),
  orgShopifyOrderIdIdx: uniqueIndex('orders_org_id_shopify_order_id_idx').on(table.orgId, table.shopifyOrderId),
  connectionSourceOrderIdx: uniqueIndex('orders_connection_source_order_idx').on(table.connectionId, table.sourceOrderId).where(sql`${table.sourceOrderId} IS NOT NULL`),
  acceptedCandidateIdx: index('orders_accepted_candidate_idx').on(table.acceptedCandidateId).where(sql`${table.acceptedCandidateId} IS NOT NULL`),
  promotionGuardCheck: check('orders_promotion_guard_check', sql`${table.source} IS NULL OR ${table.source} = 'legacy_shopify' OR ${table.acceptedCandidateId} IS NOT NULL`),
  sectionsCheck: check('orders_sections_check', sql`${table.sections} IS NULL OR (jsonb_typeof(${table.sections}) = 'object' AND ${table.sections} ?& ARRAY['identity', 'items', 'buyer', 'addresses', 'price', 'currency', 'payment', 'fulfillment', 'returns', 'context', 'evidence'])`),
  commercialStatusCheck: check('orders_commercial_status_check', sql`${table.commercialStatus} IN ('open', 'cancelled', 'closed')`),
  fulfillmentStatusCheck: check('orders_fulfillment_status_check', sql`${table.fulfillmentStatus} IN ('unfulfilled', 'partial', 'shipped', 'delivered', 'returned')`),
  paymentStatusCheck: check('orders_payment_status_check', sql`${table.paymentStatus} IN ('pending', 'cod_pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'voided', 'failed')`),
  invoiceStatusCheck: check('orders_invoice_status_check', sql`${table.invoiceStatus} IN ('not_required', 'pending', 'issued', 'failed')`),
  settlementStatusCheck: check('orders_settlement_status_check', sql`${table.settlementStatus} IN ('unsettled', 'partial', 'settled')`),
}));

export const orderItems = pgTable("order_items", {
  ...baseColumns,
  orderId: uuid("order_id").references(() => orders.id).notNull(),
  // NULL only on a 'custom_nonstock' line (0086, order_items_variant_matches_kind_check):
  // stock and cost paths must skip those lines, never assume a variant.
  variantId: uuid("variant_id").references(() => productVariants.id),
  lineKind: text("line_kind").notNull().default('mapped').$type<OrderLineKind>(),
  quantity: integer("quantity").notNull(),
  // No currency column: a line is denominated in its order's currency by
  // definition, and a second copy is a second thing that can disagree.
  priceMinor: bigint("price_minor", { mode: 'bigint' }).notNull(),
  // Cost basis captured when stock was decremented for this line (0039). NULL
  // means the item had no cost basis yet — unknown, not free; the
  // order-delivered ledger posting reports the gap rather than treating it
  // as zero COGS.
  costMinor: bigint("cost_minor", { mode: 'bigint' }),
  // 0086 provider line snapshots.
  sourceLineId: text("source_line_id"),
  title: text("title"),
  variantTitle: text("variant_title"),
  skuSnapshot: text("sku_snapshot"),
  sourceVariantId: text("source_variant_id"),
  sourceProductId: text("source_product_id"),
  currentQuantity: integer("current_quantity"),
  unfulfilledQuantity: integer("unfulfilled_quantity"),
  refundableQuantity: integer("refundable_quantity"),
  discountMinor: bigint("discount_minor", { mode: 'bigint' }),
  taxMinor: bigint("tax_minor", { mode: 'bigint' }),
  totalMinor: bigint("total_minor", { mode: 'bigint' }),
  requiresShipping: boolean("requires_shipping"),
  customAttributes: jsonb("custom_attributes"),
  taxLines: jsonb("tax_lines"),
  discountAllocations: jsonb("discount_allocations"),
}, (table) => ({
  lineKindCheck: check('order_items_line_kind_check', sql`${table.lineKind} IN ('mapped', 'custom_nonstock')`),
  variantMatchesKindCheck: check('order_items_variant_matches_kind_check', sql`(${table.lineKind} = 'custom_nonstock') = (${table.variantId} IS NULL)`),
  orderSourceLineIdx: uniqueIndex('order_items_order_source_line_idx').on(table.orderId, table.sourceLineId).where(sql`${table.sourceLineId} IS NOT NULL`),
}));

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
  // v2 (0082). Append-only: UPDATE/DELETE raise for every role. actor_id and
  // resource_id are filled from user_id / record_id by a BEFORE INSERT trigger
  // when a writer leaves them unset.
  actorKind: text("actor_kind").notNull().default('user'), // 'user' | 'webhook' | 'cron' | 'system'
  actorId: text("actor_id"),
  onBehalfOf: text("on_behalf_of"),
  channel: text("channel").notNull().default('admin'), // 'admin' | 'api' | 'webhook' | 'cron'
  outcome: text("outcome").notNull().default('success'), // 'success' | 'denied' | 'failed'
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  requestId: text("request_id"),
  correlationId: text("correlation_id"),
  ip: text("ip"),
  ua: text("ua"),
  resourceId: text("resource_id"),
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
export * from './schema/index';
