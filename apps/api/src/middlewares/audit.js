import { db } from '../db';
import { auditLog } from '@irth/db';
// A simpler way to satisfy "Audit log via Drizzle middleware" is to inject an audited db instance
// into the Hono context via middleware.
export const auditMiddleware = () => async (c, next) => {
    const userId = c.get('userId') || '00000000-0000-0000-0000-000000000000';
    const orgId = c.get('orgId') || '00000000-0000-0000-0000-000000000000';
    // We can inject a function into the context to log audits
    c.set('audit', async (action, tableName, recordId, changes) => {
        await db.insert(auditLog).values({
            orgId,
            userId,
            action,
            tableName,
            recordId,
            changes
        });
    });
    await next();
};
