import { MiddlewareHandler } from 'hono';
import { Role } from '@irth/db/src/permissions';

// Authorizes the request against the trusted role established by authContext.
// Relies on c.get('orgId'/'role') — never on client-supplied headers.
export function requireRole(...allowedRoles: Role[]): MiddlewareHandler {
  return async (c, next) => {
    const orgId = c.get('orgId') as string | undefined;
    const role = c.get('role') as Role | undefined;

    if (!orgId || !role) {
      return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    }

    if (!allowedRoles.includes(role)) {
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }

    await next();
  };
}
