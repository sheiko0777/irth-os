import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { auditLog } from './schema';

export * from './schema';

export const createDb = (url: string) => {
  const client = postgres(url);
  return drizzle(client, { schema });
};

export const db = typeof process !== 'undefined' && process.env.DATABASE_URL
    ? createDb(process.env.DATABASE_URL)
    : createDb('postgresql://postgres:postgres@localhost:5432/irth');

// To genuinely satisfy "via Drizzle middleware" for an audit log, we intercept mutations at the database object level.
// Since Drizzle currently doesn't have a built-in cross-table middleware that easily exposes the table name and values generically in a typed way before execution,
// creating a thin wrapper around transactions or specific operations is the recommended "middleware" approach for complex audits.

type AuditContext = {
    userId: string | null;
    orgId: string;
    action: string;
    tableName: string;
    recordId: string;
};

/**
 * A Drizzle-level wrapper ("middleware") for executing operations and automatically
 * logging them to the audit_log table in the same context.
 */
export async function withAudit<T>(
    dbInstance: any,
    auditContext: AuditContext,
    operation: (tx: any) => Promise<T>,
    changes: unknown
): Promise<T> {
    return await dbInstance.transaction(async (tx: any) => {
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
