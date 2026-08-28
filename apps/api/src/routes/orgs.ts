import { handleError } from "../utils/errors";
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db, withOrg } from '../db';
import { organizations, orgMembers, orgInvites, withAudit, jsonSafe, setActiveOrg, NotAMemberError } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middlewares/requireRole';

export const orgsRouter = new Hono();

const switchOrgSchema = z.object({
  orgId: z.string().uuid(),
});

// Kept symmetric with apps/admin/src/server/routers/me.ts's `switchOrg`
// mutation — authContext.ts does the exact same resolution as createContext,
// so a client hitting this API directly (a future mobile client, an
// integration test) would otherwise have no way to ever change its active
// org. Both surfaces call the same packages/db/src/orgContext.ts function.
orgsRouter.post('/switch', async (c: Context) => {
  try {
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const body = await c.req.json();
    const { orgId } = switchOrgSchema.parse(body);

    const membership = await setActiveOrg(db, userId, orgId);
    return c.json({ data: jsonSafe(membership), error: null, meta: null });
  } catch (error: unknown) {
    if (error instanceof NotAMemberError) {
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

orgsRouter.get('/:id/members', async (c: Context) => {
  try {
    const id = c.req.param('id');
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    if (id !== orgId) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);

    const members = await db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId));
    return c.json({ data: jsonSafe(members), error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});

orgsRouter.post('/:id/invite', requireRole('owner', 'admin'), async (c: Context) => {
  try {
    const id = c.req.param('id');
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    if (id !== orgId) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);

    const body = await c.req.json();
    const { email, role } = inviteSchema.parse(body);

    const userRole = c.get('role') as string;
    if (userRole === 'admin' && role === 'owner') {
      return c.json({ data: null, error: 'Forbidden', meta: null }, 403);
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
       return c.json({ data: null, error: 'Organization not found', meta: null }, 404);
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    const [invite] = await db.insert(orgInvites).values({
      orgId,
      email,
      token,
      role,
      expiresAt,
    }).returning();

    // Invite email delivery is not wired up yet.

    return c.json({ data: jsonSafe(invite), error: null, meta: null }, 201);
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const acceptInviteSchema = z.object({
  token: z.string(),
});

orgsRouter.post('/invite/accept', async (c: Context) => {
  try {
    // The accepting user is the authenticated session user — never trust a
    // userId supplied in the request body.
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const body = await c.req.json();
    const { token } = acceptInviteSchema.parse(body);

    const [invite] = await db.select().from(orgInvites).where(eq(orgInvites.token, token));
    if (!invite) {
      return c.json({ data: null, error: 'Invalid token', meta: null }, 400);
    }

    if (new Date() > invite.expiresAt) {
      return c.json({ data: null, error: 'Token expired', meta: null }, 400);
    }

    const [member] = await db.insert(orgMembers).values({
      orgId: invite.orgId,
      userId,
      role: invite.role,
    }).returning();

    await db.delete(orgInvites).where(eq(orgInvites.id, invite.id));

    return c.json({ data: jsonSafe(member), error: null, meta: null }, 201);
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});


const updateRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

orgsRouter.patch('/members/:memberId/role', requireRole('owner'), async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    const memberId = c.req.param('memberId');
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const body = await c.req.json();
    const { role } = updateRoleSchema.parse(body);
    const userId = c.get('userId') as string;

    const result = await withOrg(c, (tx) => withAudit(tx, async () => {
      const [updated] = await tx.update(orgMembers)
        .set({ role })
        .where(and(
          eq(orgMembers.id, memberId as string),
          eq(orgMembers.orgId, orgId as string)
        )).returning();
      return updated;
    }, {
      orgId,
      userId,
      action: 'UPDATE_MEMBER_ROLE',
      tableName: 'org_members',
      changes: { role }
    }));

    if (!result) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    return c.json({ data: jsonSafe(result), error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});
