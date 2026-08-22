import { pgTable, uuid, timestamp, text, decimal, bigint, boolean } from "drizzle-orm/pg-core";

export const priceLists = pgTable("price_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  currency: text("currency").notNull().default('EGP'),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }),
  isDefault: boolean("is_default").notNull().default(false),
  customerGroupId: uuid("customer_group_id"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const priceListItems = pgTable("price_list_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  priceListId: uuid("price_list_id").notNull().references(() => priceLists.id, { onDelete: 'cascade' }),
  orgId: uuid("org_id").notNull(),
  productId: uuid("product_id").notNull(),
  variantId: uuid("variant_id"),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  priceMinor: bigint("price_minor", { mode: 'number' }).notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});