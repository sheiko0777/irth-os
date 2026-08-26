import { pgTable, uuid, timestamp, text, integer, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from '../schema';

export const stocktakingStatusEnum = pgEnum('stocktaking_status', ['draft', 'in_progress', 'completed', 'cancelled']);

export const stocktakingSessions = pgTable("stocktaking_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  status: stocktakingStatusEnum("status").notNull().default('draft'),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  // Set when the counted quantities were written to inventory. Distinct from
  // completedAt so a future flow could complete without reconciling.
  appliedAt: timestamp("applied_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const stocktakingItems = pgTable("stocktaking_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => stocktakingSessions.id, { onDelete: 'cascade' }),
  orgId: uuid("org_id").notNull(),
  productId: uuid("product_id").notNull(),
  variantId: uuid("variant_id"),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  expectedQuantity: integer("expected_quantity").notNull().default(0),
  actualQuantity: integer("actual_quantity"),
  variance: integer("variance"),
  // The quantity actually written to inventory. NULL means nothing was applied
  // for this line (unresolvable variant or missing inventory record).
  appliedQuantity: integer("applied_quantity"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});