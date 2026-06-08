import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as baseSchema from './schema';
import * as inventorySchema from './schema/inventory';
import * as outboxSchema from './schema/outbox';
import * as orgSettingsSchema from './schema/orgSettings';
import * as etaInvoicesSchema from './schema/etaInvoices';
import * as couriersSchema from './schema/couriers';
import * as returnsSchema from './schema/returns';
import * as purchasingSchema from './schema/purchasing';
import * as customersSchema from './schema/customers';
import * as couponsSchema from './schema/coupons';
import * as stocktakingSchema from './schema/stocktaking';
import * as pricelistsSchema from './schema/pricelists';
import * as shippingZonesSchema from './schema/shippingZones';

const schema = { ...baseSchema, ...inventorySchema, ...outboxSchema, ...orgSettingsSchema, ...etaInvoicesSchema, ...couriersSchema, ...returnsSchema, ...purchasingSchema, ...customersSchema, ...couponsSchema, ...stocktakingSchema, ...pricelistsSchema, ...shippingZonesSchema };
import { auditLog } from './schema';

export * from './schema';
export * from './schema/inventory';
export * from './schema/outbox';
export * from './schema/orgSettings';
export * from './schema/etaInvoices';
export * from './schema/couriers';
export * from './schema/returns';
export * from './schema/purchasing';
export * from './schema/customers';
export * from './schema/coupons';
export * from './schema/stocktaking';
export * from './schema/pricelists';
export * from './schema/shippingZones';

export const createDb = (url: string) => {
  // prepare: false required for Supabase Transaction pooler (port 6543)
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
};

export type DbInstance = ReturnType<typeof createDb>;

// DATABASE_URL is always set (GitHub secret / .env.local). Non-null assertion is intentional.
export const db = createDb(process.env.DATABASE_URL!);

export async function withAudit<T extends { id?: string }>(
    dbInstance: DbInstance,
    operation: () => Promise<T>,
    auditData: { orgId: string, userId: string | null, action: string, tableName: string, changes: Record<string, unknown> }
) {
    const result = await operation();
    const recordId = result?.id || 'unknown_id';
    await dbInstance.insert(auditLog).values({ ...auditData, recordId });
    return result;
}