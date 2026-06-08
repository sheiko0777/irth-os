import { pgTable, uuid, timestamp, text, decimal, boolean, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const shippingRateTypeEnum = pgEnum('shipping_rate_type', ['flat', 'weight_based', 'price_based', 'free']);

export const shippingZones = pgTable("shipping_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  countries: jsonb("countries").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const shippingRates = pgTable("shipping_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  zoneId: uuid("zone_id").notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  rateType: shippingRateTypeEnum("rate_type").notNull().default('flat'),
  price: decimal("price", { precision: 12, scale: 2 }).notNull().default('0'),
  minOrderValue: decimal("min_order_value", { precision: 12, scale: 2 }),
  maxOrderValue: decimal("max_order_value", { precision: 12, scale: 2 }),
  minWeight: decimal("min_weight", { precision: 8, scale: 3 }),
  maxWeight: decimal("max_weight", { precision: 8, scale: 3 }),
  estimatedDaysMin: integer("estimated_days_min"),
  estimatedDaysMax: integer("estimated_days_max"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});