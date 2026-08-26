import { pgTable, uuid, timestamp, text, decimal, bigint, boolean, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from '../schema';

export const shippingRateTypeEnum = pgEnum('shipping_rate_type', ['flat', 'weight_based', 'price_based', 'free']);

export const shippingZones = pgTable("shipping_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  countries: jsonb("countries").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const shippingRates = pgTable("shipping_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  zoneId: uuid("zone_id").notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  rateType: shippingRateTypeEnum("rate_type").notNull().default('flat'),
  priceMinor: bigint("price_minor", { mode: 'bigint' }).notNull().default(0n),
  minOrderValueMinor: bigint("min_order_value_minor", { mode: 'bigint' }),
  maxOrderValueMinor: bigint("max_order_value_minor", { mode: 'bigint' }),
  // Weights stay decimal: a parcel really does weigh 1.250 kg. These are
  // physical quantities, not money, so rule 1 does not apply to them.
  minWeight: decimal("min_weight", { precision: 8, scale: 3 }),
  maxWeight: decimal("max_weight", { precision: 8, scale: 3 }),
  estimatedDaysMin: integer("estimated_days_min"),
  estimatedDaysMax: integer("estimated_days_max"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});