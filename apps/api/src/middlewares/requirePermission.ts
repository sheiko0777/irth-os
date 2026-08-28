import { MiddlewareHandler } from 'hono';
import { can, type ActionFor, type Resource, type Role } from '@irth/db';

// Authorizes the request against the trusted role established by authContext,
// checked against the shared resource.action matrix in
// packages/db/src/permissions.ts rather than a fixed role list — mirrors
// requireRole.ts's shape. Relies on c.get('orgId'/'role') — never on
// client-supplied headers.
export function requirePermission<R extends Resource>(resource: R, action: ActionFor<R>): MiddlewareHandler {
  return async (c, next) => {
    const orgId = c.get('orgId') as string | undefined;
    const role = c.get('role') as Role | undefined;

    if (!orgId || !role) {
      return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    }

    if (!can(role, resource, action)) {
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }

    await next();
  };
}
