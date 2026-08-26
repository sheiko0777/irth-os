import { pgTable, uuid, timestamp, text, integer, bigint, pgEnum } from "drizzle-orm/pg-core";
import { productVariants } from "../schema";
import { organizations } from '../schema';

export const movementTypeEnum = pgEnum('movement_type', ['in', 'out', 'adjustment']);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  quantity: integer("quantity").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(10),
  // Weighted-average cost per unit, minor units. NULL until a receipt with a
  // known unit cost first updates it (0039) — see packages/db/src/costing.ts.
  averageCostMinor: bigint("average_cost_minor", { mode: 'bigint' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  type: movementTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(),
  // Total cost of THIS movement (quantity x unit cost at the time), minor
  // units. NULL for a movement with no known cost basis (0039) — a manual
  // adjustment with nothing purchased behind it, for instance.
  costMinor: bigint("cost_minor", { mode: 'bigint' }),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
