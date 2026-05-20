import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  jsonb,
  decimal,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

export const brandEnum = pgEnum("brand", ["irth"]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "payment_failed",
  "shipped",
  "delivered",
  "cancelled",
]);
export const shippingProviderEnum = pgEnum("shipping_provider", [
  "bosta",
  "mylerz",
]);

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
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgInvites = pgTable("org_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("member"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  parentId: uuid("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  categoryId: uuid("category_id").references(() => categories.id),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sku: text("sku").notNull().unique(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  stock: integer("stock").notNull().default(0),
  status: text("status").notNull().default("active"), // 'active' | 'draft' | 'archived'
  images: jsonb("images").default([]),
  brand: brandEnum("brand").default("irth").notNull(), // Keeping brand to not break existing tests/code without need, or maybe we drop it? The spec didn't mention it. I will keep it for safety unless told otherwise. Actually I will just keep it since it's an enum we have.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  price: decimal("price", { precision: 12, scale: 2 }),
  stock: integer("stock").notNull().default(0),
  attributes: jsonb("attributes").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orders = pgTable("orders", {
  ...baseColumns,
  orderNumber: varchar("order_number", { length: 50 }).notNull().unique(), // IRT-2026-0001
  status: orderStatusEnum("status").notNull().default("pending"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  customerId: uuid("customer_id"), // Ref to auth users eventually
});

export const orderItems = pgTable("order_items", {
  ...baseColumns,
  orderId: uuid("order_id")
    .references(() => orders.id)
    .notNull(),
  variantId: uuid("variant_id")
    .references(() => productVariants.id)
    .notNull(),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
});

export const shipmentTracking = pgTable("shipment_tracking", {
  ...baseColumns,
  orderId: uuid("order_id")
    .references(() => orders.id)
    .notNull(),
  provider: shippingProviderEnum("provider").notNull(),
  trackingNumber: varchar("tracking_number", { length: 255 }),
  status: varchar("status", { length: 100 }), // The provider's status, mapped later to order status
  rawPayload: jsonb("raw_payload").default({}),
});

export const auditLog = pgTable("audit_log", {
  ...baseColumns,
  userId: uuid("user_id"), // Ref to auth users
  action: varchar("action", { length: 255 }).notNull(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  recordId: uuid("record_id").notNull(),
  changes: jsonb("changes").notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  userId: text("user_id").notNull(),
  type: text("type").notNull(), // 'invite_accepted' | 'member_joined' | 'order_status' | 'system'
  title: text("title").notNull(),
  body: text("body"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
});
