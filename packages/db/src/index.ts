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
import * as campaignsSchema from './schema/campaigns';
import * as giftCardsSchema from './schema/giftCards';
import * as customerSegmentsSchema from './schema/customerSegments';
import * as orgFeatureFlagsSchema from './schema/orgFeatureFlags';
import * as notificationsSchema from './schema/notifications';

const schema = { ...baseSchema, ...inventorySchema, ...outboxSchema, ...orgSettingsSchema, ...etaInvoicesSchema, ...couriersSchema, ...returnsSchema, ...purchasingSchema, ...customersSchema, ...couponsSchema, ...stocktakingSchema, ...pricelistsSchema, ...shippingZonesSchema, ...campaignsSchema, ...giftCardsSchema, ...customerSegmentsSchema, ...orgFeatureFlagsSchema, ...notificationsSchema };
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
export * from './schema/campaigns';
export * from './schema/giftCards';
export * from './schema/customerSegments';
export * from './schema/orgFeatureFlags';
export * from './schema/notifications';

export const createDb = (url: string) => {
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
};

export type DbInstance = ReturnType<typeof createDb>;

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