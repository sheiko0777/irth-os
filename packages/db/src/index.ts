import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { jsonSafe } from './json';
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
import * as documentCountersSchema from './schema/documentCounters';
import * as idempotencySchema from './schema/idempotency';
import * as ledgerSchema from './schema/ledger';
import * as authSchema from './schema/auth';

const schema = { ...baseSchema, ...inventorySchema, ...outboxSchema, ...orgSettingsSchema, ...etaInvoicesSchema, ...couriersSchema, ...returnsSchema, ...purchasingSchema, ...customersSchema, ...couponsSchema, ...stocktakingSchema, ...pricelistsSchema, ...shippingZonesSchema, ...campaignsSchema, ...giftCardsSchema, ...customerSegmentsSchema, ...orgFeatureFlagsSchema, ...documentCountersSchema, ...idempotencySchema, ...ledgerSchema, ...authSchema };
import { auditLog } from './schema';

export * from './json';
export * from './permissions';
export * from './schema';
export * from './schema/auth';
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
export * from './schema/documentCounters';
export * from './schema/idempotency';
export * from './schema/ledger';
export * from './ledger';
export * from './costing';
export * from './idempotency';
export * from './outbox';
export * from './activeOrganization';

export const createDb = (url: string) => {
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
};

export type DbInstance = ReturnType<typeof createDb>;
let _dbInstance: DbInstance | null = null;
function realDb(): DbInstance {
  if (!_dbInstance) _dbInstance = createDb(process.env.DATABASE_URL!);
  return _dbInstance;
}
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, _receiver) {
    const instance = realDb();
    const value = Reflect.get(instance as object, prop, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export async function withOrgContext<T>(
  dbInstance: DbInstance,
  orgId: string,
  fn: (tx: Parameters<Parameters<DbInstance['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    throw new TypeError(`withOrgContext requires a uuid orgId, got ${JSON.stringify(orgId)}`);
  }
  return dbInstance.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('role', 'irth_app', true), set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export type DbTx = Parameters<Parameters<DbInstance['transaction']>[0]>[0];
type AuditWriter = Pick<DbTx, 'insert' | 'rollback'>;

export async function withAudit<T extends { id?: string }>(
    dbInstance: AuditWriter,
    operation: () => Promise<T>,
    auditData: { orgId: string, userId: string | null, action: string, tableName: string, changes: Record<string, unknown> }
) {
    const result = await operation();
    const recordId = result?.id ?? null;
    await dbInstance.insert(auditLog).values({
        ...auditData,
        changes: jsonSafe(auditData.changes),
        recordId,
    });
    return result;
}

export type DocumentKind = 'order' | 'return' | 'purchase_order';
export async function nextDocumentNumber(tx: Pick<DbTx, 'execute' | 'rollback'>, orgId: string, kind: DocumentKind): Promise<number> {
    const rows = await tx.execute<{ last_value: string | number | bigint }>(sql`
        INSERT INTO org_document_counters (org_id, kind, last_value, updated_at)
        VALUES (${orgId}, ${kind}, 1, now())
        ON CONFLICT (org_id, kind) DO UPDATE
            SET last_value = org_document_counters.last_value + 1, updated_at = now()
        RETURNING last_value
    `);
    const [row] = [...rows];
    if (!row) throw new Error(`nextDocumentNumber(${kind}) returned no row for org ${orgId}.`);
    return Number(row.last_value);
}

export function formatDocumentNumber(kind: DocumentKind, value: number, year?: number): string {
    const seq = String(value).padStart(4, '0');
    switch (kind) {
        case 'order': return `IRT-${year ?? new Date().getFullYear()}-${seq}`;
        case 'return': return `RMA-${seq}`;
        case 'purchase_order': return `PO-${year ?? new Date().getFullYear()}-${seq}`;
    }
}
