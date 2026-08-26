import type { MiddlewareHandler } from 'hono';
import { db } from '../db';
import { orgMembers, parseActiveOrganizationId } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import type { Role } from '@irth/db';
import { auth } from '../auth';
import { isPublic } from './publicRoutes';

export const authContext = (): MiddlewareHandler => async (c, next) => {
  if (isPublic(c.req.path)) return next();

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

  const userId = session.user.id;
  c.set('userId', userId);

  const requestedOrgId = parseActiveOrganizationId(c.req.header('cookie'));
  let membership;

  if (requestedOrgId) {
    [membership] = await db.select().from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, requestedOrgId)))
      .limit(1);
    if (!membership) return c.json({ data: null, error: 'Active organization access denied', meta: null }, 403);
  } else {
    [membership] = await db.select().from(orgMembers)
      .where(eq(orgMembers.userId, userId))
      .limit(1);
  }

  if (membership) {
    c.set('orgId', membership.orgId);
    c.set('role', membership.role as Role);
  }

  await next();
};
