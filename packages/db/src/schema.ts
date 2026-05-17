import { pgTable, uuid, timestamp, varchar, text, jsonb, decimal, boolean, integer, pgEnum } from "drizzle-orm/pg-core";

export const brandEnum = pgEnum('brand', ['irth']);

// Base columns for all tables with org_id rule
const baseColumns = {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const products = pgTable("products", {
  ...baseColumns,
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  brand: brandEnum("brand").default('irth').notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const productVariants = pgTable("product_variants", {
  ...baseColumns,
  productId: uuid("product_id").references(() => products.id).notNull(),
  sku: varchar("sku", { length: 100 }).notNull(),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  stock: integer("stock").default(0).notNull(),
});

export const orders = pgTable("orders", {
  ...baseColumns,
  orderNumber: varchar("order_number", { length: 50 }).notNull().unique(), // IRT-2026-0001
  status: varchar("status", { length: 50 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  customerId: uuid("customer_id"), // Ref to auth users eventually
});

export const orderItems = pgTable("order_items", {
  ...baseColumns,
  orderId: uuid("order_id").references(() => orders.id).notNull(),
  variantId: uuid("variant_id").references(() => productVariants.id).notNull(),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
});

export const auditLog = pgTable("audit_log", {
  ...baseColumns,
  userId: uuid("user_id"), // Ref to auth users
  action: varchar("action", { length: 255 }).notNull(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  recordId: uuid("record_id").notNull(),
  changes: jsonb("changes").notNull(),
});
