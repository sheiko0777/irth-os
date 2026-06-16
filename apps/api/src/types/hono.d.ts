import type { Role } from '@irth/db/src/permissions';

// Trusted request identity established by authContext, plus the audit helper set
// by auditMiddleware. Typing these makes c.get/c.set on the Hono context safe.
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    role: Role;
    audit: (
      action: string,
      tableName: string,
      recordId: string,
      changes: unknown,
    ) => Promise<void>;
  }
}
