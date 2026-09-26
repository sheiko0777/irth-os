import { MiddlewareHandler } from 'hono';
import { canAccess, type ActionFor, type EffectiveAccess, type Resource } from '@irth/db';

// Authorizes the request against the effective access authContext resolved for
// this member (0074: role permissions + per-person grants − revokes), checked
// with the shared resource.action matrix in packages/db/src/permissions.ts —
// the same check apps/admin's requirePermission makes. Relies on
// c.get('orgId'/'access') — never on client-supplied headers.
export function requirePermission<R extends Resource>(resource: R, action: ActionFor<R>): MiddlewareHandler {
  return async (c, next) => {
    const orgId = c.get('orgId') as string | undefined;
    const access = c.get('access') as EffectiveAccess | undefined;

    if (!orgId || !access) {
      return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    }

    if (!canAccess(access, resource, action)) {
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }

    await next();
  };
}
