import { pgTable, uuid, timestamp, text, bigint, integer, boolean } from "drizzle-orm/pg-core";

export const priceLists = pgTable("price_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  currency: text("currency").notNull().default('EGP'),
  // A rate, not money — basis points so nobody writes `total * (pct / 100)`
  // in a float. 10% is 1000. CHECK-constrained to 0..10000 in 0028.
  discountBp: integer("discount_bp"),
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
  priceMinor: bigint("price_minor", { mode: 'bigint' }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});