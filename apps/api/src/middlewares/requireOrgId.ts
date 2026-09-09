import { MiddlewareHandler } from 'hono';

// Requires the trusted organization established by authContext.
// Relies on c.get('orgId') — never on client-supplied headers.
export function requireOrgId(): MiddlewareHandler {
  return async (c, next) => {
    const orgId = c.get('orgId') as string | undefined;

    if (!orgId) {
      return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    }

    await next();
  };
}
