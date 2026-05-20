import postgres from 'postgres';
import * as schema from './schema';
export * from './schema';
export declare const createDb: (url: string) => import("drizzle-orm/postgres-js").PostgresJsDatabase<typeof schema> & {
    $client: postgres.Sql<{}>;
};
export declare const db: import("drizzle-orm/postgres-js").PostgresJsDatabase<typeof schema> & {
    $client: postgres.Sql<{}>;
};
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
export declare function withAudit<T>(dbInstance: any, auditContext: AuditContext, operation: (tx: any) => Promise<T>, changes: unknown): Promise<T>;
