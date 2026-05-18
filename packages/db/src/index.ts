import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { auditLog } from './schema';

export * from './schema';

export const createDb = (url: string) => {
  const client = postgres(url);
  return drizzle(client, { schema });
};

export const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null as any;

export async function withAudit<T extends { id?: string }>(
    dbInstance: any, 
    operation: () => Promise<T>, 
    auditData: { orgId: string, userId: string | null, action: string, tableName: string, changes: any }
) {
    const result = await operation();
    
    // Fallback to a placeholder if result doesn't have an id (e.g. not returning)
    const recordId = result?.id || 'unknown_id';

    await dbInstance.insert(auditLog).values({
        ...auditData,
        recordId
    });
    
    return result;
}
