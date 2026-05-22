import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as baseSchema from './schema';
import * as inventorySchema from './schema/inventory';
import * as outboxSchema from './schema/outbox';
import * as orgSettingsSchema from './schema/orgSettings';

const schema = { ...baseSchema, ...inventorySchema, ...outboxSchema, ...orgSettingsSchema };
import { auditLog } from './schema';

export * from './schema';
export * from './schema/inventory';
export * from './schema/outbox';
export * from './schema/orgSettings';

export const createDb = (url: string) => {
  // prepare: false required for Supabase Transaction pooler (port 6543)
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
};

export const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null as any;

export async function withAudit<T extends { id?: string }>(
    dbInstance: any,
    operation: () => Promise<T>,
    auditData: { orgId: string, userId: string | null, action: string, tableName: string, changes: any }
) {
    const result = await operation();
    const recordId = result?.id || 'unknown_id';
    await dbInstance.insert(auditLog).values({ ...auditData, recordId });
    return result;
}
