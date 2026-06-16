import type { MiddlewareHandler } from 'hono';
import { db } from '../db';
import { orgMembers } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import type { Role } from '@irth/db/src/permissions';
import { auth } from '../auth';

// Routes that authenticate by other means (Better Auth itself, signature-verified
// webhooks) or need no auth (health) are skipped. Everything else under /api/*
// must carry a valid session.
const PUBLIC_PREFIXES = ['/api/auth', '/api/webhooks', '/webhooks', '/health'];

function isPublic(path: string): boolean {
  // Non-/api routes (health, webhooks, root) are not session-gated here.
  if (!path.startsWith('/api/')) return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * Establishes a trusted request identity from the Better Auth session and exposes
 * it via the Hono context (`userId`, `orgId`, `role`). Routes and downstream
 * middleware must read these from the context — never from client-supplied
 * `org_id`/`user_id` headers, which are not trustworthy.
 */
export const authContext = (): MiddlewareHandler => async (c, next) => {
  if (isPublic(c.req.path)) {
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }

  const userId = session.user.id;
  c.set('userId', userId);

  // Resolve tenant + role from membership (active org preferred). Onboarding
  // routes (e.g. invite accept) only need userId, so a missing membership is not
  // fatal here — org-scoped routes guard on `orgId` themselves.
  const activeOrgId = (session.session as { activeOrganizationId?: string } | undefined)
    ?.activeOrganizationId;

  let membership;
  if (activeOrgId) {
    [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, activeOrgId)))
      .limit(1);
  }
  if (!membership) {
    [membership] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, userId))
      .limit(1);
  }

  if (membership) {
    c.set('orgId', membership.orgId);
    c.set('role', membership.role as Role);
  }

  await next();
};
