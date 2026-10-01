import { MiddlewareHandler } from 'hono';
import { canAccess, logDenial, type ActionFor, type EffectiveAccess, type Resource } from '@irth/db';
import { withOrg } from '../db';

// Authorizes the request against the effective access authContext resolved for
// this member (0074: role permissions + per-person grants − revokes), checked
// with the shared resource.action matrix in packages/db/src/permissions.ts —
// the same check apps/admin's requirePermission makes. Relies on
// c.get('orgId'/'access') — never on client-supplied headers.
//
// A 403 is audited (outcome='denied', channel='api') through the same
// throttled logDenial apps/admin uses: method + route pattern, never the body.
export function requirePermission<R extends Resource>(resource: R, action: ActionFor<R>): MiddlewareHandler {
  return async (c, next) => {
    const orgId = c.get('orgId') as string | undefined;
    const access = c.get('access') as EffectiveAccess | undefined;

    if (!orgId || !access) {
      return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    }

    if (!canAccess(access, resource, action)) {
      await logDenial((fn) => withOrg(c, fn), {
        orgId,
        userId: (c.get('userId') as string | undefined) ?? null,
        path: `${c.req.method} ${c.req.routePath}`,
        permission: `${String(resource)}.${String(action)}`,
        channel: 'api',
        requestId: (c.get('requestId') as string | undefined) ?? null,
      });
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }

    await next();
  };
}
