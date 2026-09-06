import { pgTable, text, timestamp, uuid, jsonb, uniqueIndex, pgPolicy } from "drizzle-orm/pg-core";
import { organizations, orders } from "../schema";

export const paymobWebhookDeliveries = pgTable("paymob_webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").references(() => orders.id),
  transactionId: text("transaction_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("processed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgTransactionUnique: uniqueIndex("paymob_webhook_deliveries_org_transaction_idx").on(table.orgId, table.transactionId),
  tenantIsolation: pgPolicy("tenant_isolation", {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: require('drizzle-orm').sql`"org_id" = current_setting('app.current_org_id', true)::uuid`,
  }),
})).enableRLS();
