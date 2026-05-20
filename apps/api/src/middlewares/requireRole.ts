import { MiddlewareHandler } from 'hono';
import { db } from '../db';
import { orgMembers } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { Role } from '@irth/db/src/permissions';

export function requireRole(...allowedRoles: Role[]): MiddlewareHandler {
  return async (c, next) => {
    const orgId = c.req.header('org_id');
    const userId = c.req.header('user_id');

    if (!orgId || !userId) {
      return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    }

    const [member] = await db.select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

    if (!member || !allowedRoles.includes(member.role as Role)) {
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }

    await next();
  };
}
