import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { auditLog } from './schema';
export * from './schema';
export const createDb = (url) => {
    const client = postgres(url);
    return drizzle(client, { schema });
};
export const db = typeof process !== 'undefined' && process.env.DATABASE_URL
    ? createDb(process.env.DATABASE_URL)
    : createDb('postgresql://postgres:postgres@localhost:5432/irth');
/**
 * A Drizzle-level wrapper ("middleware") for executing operations and automatically
 * logging them to the audit_log table in the same context.
 */
export async function withAudit(dbInstance, auditContext, operation, changes) {
    return await dbInstance.transaction(async (tx) => {
        const result = await operation(tx);
        await tx.insert(auditLog).values({
            orgId: auditContext.orgId,
            userId: auditContext.userId,
            action: auditContext.action,
            tableName: auditContext.tableName,
            recordId: auditContext.recordId,
            changes
        });
        return result;
    });
}
