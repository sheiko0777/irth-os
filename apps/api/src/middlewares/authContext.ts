import type { MiddlewareHandler } from 'hono';
import { db } from '../db';
import { orgMembers } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import type { Role } from '@irth/db/src/permissions';
import { auth } from '../auth';
// Kept in its own module so the predicate can be tested without importing
// `../auth`, which initializes a database adapter at import time.
import { isPublic } from './publicRoutes';

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

  // Resolve tenant + role from membership. Onboarding routes (e.g. invite
  // accept) only need userId, so a missing membership is not fatal here —
  // org-scoped routes guard on `orgId` themselves.
  //
  // This used to prefer `session.activeOrganizationId` and fall back to the
  // first membership. That branch could never run: `active_organization_id` is
  // added by Better Auth's organization plugin, which is deliberately not
  // enabled (see ../auth.ts), so the column does not exist and the value was
  // always undefined. The fallback was the only live path.
  //
  // The honest consequence, stated rather than hidden behind dead code: a user
  // who belongs to more than one organization always lands in whichever
  // membership Postgres returns first, and cannot switch. Implementing org
  // switching means storing the choice somewhere real — a column on `session`
  // or a `last_active_org_id` on the user — not reading a field nothing writes.
  const [membership] = await db
    .select()
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);

  if (membership) {
    c.set('orgId', membership.orgId);
    c.set('role', membership.role as Role);
  }

  await next();
};
