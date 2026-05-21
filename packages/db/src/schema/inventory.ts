import { pgTable, uuid, timestamp, text, integer, pgEnum } from "drizzle-orm/pg-core";
import { productVariants } from "../schema";

export const movementTypeEnum = pgEnum('movement_type', ['in', 'out', 'adjustment']);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: text("org_id").notNull(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  quantity: integer("quantity").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(10),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: text("org_id").notNull(),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  type: movementTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
