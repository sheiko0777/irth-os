import type { MiddlewareHandler } from 'hono';
import { hiddenKeys, redact, type EffectiveAccess } from '@irth/db';

/**
 * Sensitive fields (PR-1e) for the Worker API: the same rules the admin's
 * tRPC middleware applies (packages/db/src/redaction.ts), applied to every
 * JSON response a member receives. `/api/orders/…` is matched as the
 * `orders.` procedure path, so one rule table serves both apps.
 */
export function apiRulePath(requestPath: string): string | null {
  const m = /^\/api\/([^/]+)(?:\/(.*))?$/.exec(requestPath);
  if (!m) return null;
  return `${m[1]}.${(m[2] ?? '').replace(/\//g, '.')}`;
}

export const redactResponse = (): MiddlewareHandler => async (c, next) => {
  await next();
  const access = c.get('access') as EffectiveAccess | undefined;
  const path = apiRulePath(c.req.path);
  if (!access || !path) return;
  const hidden = hiddenKeys(access, path);
  if (hidden.size === 0) return;
  if (!(c.res.headers.get('content-type') ?? '').includes('application/json')) return;

  const body: unknown = await c.res.json();
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  c.res = new Response(JSON.stringify(redact(body, hidden)), { status: c.res.status, headers });
};
