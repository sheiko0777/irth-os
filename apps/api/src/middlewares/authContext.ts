import type { MiddlewareHandler } from 'hono';
import { db } from '../db';
import { resolveActiveOrgMembership } from '@irth/db';
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
  // Needed by /invite/accept's email-match check (packages/db/src/invites.ts
  // acceptOrgInvite) — org-scoped routes never need this, but onboarding
  // routes that run before a membership exists do.
  c.set('userEmail', session.user.email);

  // Resolve tenant + role from membership. Onboarding routes (e.g. invite
  // accept) only need userId, so a missing membership is not fatal here —
  // org-scoped routes guard on `orgId` themselves.
  //
  // Single shared resolver — see packages/db/src/orgContext.ts for why (this
  // file and apps/admin/src/server/trpc.ts::createContext used to each run
  // their own copy of the same "first membership wins" query independently).
  const membership = await resolveActiveOrgMembership(db, userId);

  if (membership) {
    c.set('orgId', membership.orgId);
    c.set('role', membership.role);
  }

  await next();
};
