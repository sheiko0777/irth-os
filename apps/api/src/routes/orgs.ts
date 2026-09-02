import { handleError } from "../utils/errors";
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db, withOrg } from '../db';
import {
  organizations, orgMembers, orgInvites, withAudit, jsonSafe, setActiveOrg, NotAMemberError,
  emitOutboxEvent, generateInviteOtp, acceptOrgInvite,
} from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middlewares/requireRole';
import { envVar } from '../utils/env';

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
    const { code: otpCode, expiresAt: otpExpiresAt } = generateInviteOtp();

    // Wrapped in withOrg, matching PATCH /members/:memberId/role below — the
    // insert and the outbox emit must commit together or not at all, same
    // reasoning as apps/admin's members.ts invite mutation.
    const userId = c.get('userId') as string;
    const invite = await withOrg(c, (tx) => withAudit(tx, async () => {
      const [row] = await tx.insert(orgInvites).values({
        orgId, email, token, role, expiresAt, otpCode, otpExpiresAt,
      }).returning();
      const joinUrl = `${envVar('ADMIN_APP_URL') ?? 'https://app.irth-house.com'}/ar/join?token=${token}`;
      await emitOutboxEvent(tx, {
        orgId, eventType: 'org.invite.sent',
        payload: { orgId, inviteId: row.id, email, orgName: org.name, role, otpCode, joinUrl },
      });
      return row;
    }, {
      orgId, userId, action: 'INVITE_MEMBER', tableName: 'org_invites', changes: { email, role },
    }));

    return c.json({ data: jsonSafe(invite), error: null, meta: null }, 201);
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const acceptInviteSchema = z.object({
  token: z.string(),
  otpCode: z.string().optional(),
});

orgsRouter.post('/invite/accept', async (c: Context) => {
  try {
    // The accepting user is the authenticated session user — never trust a
    // userId supplied in the request body.
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    const userEmail = c.get('userEmail') as string | undefined;

    const body = await c.req.json();
    const { token, otpCode } = acceptInviteSchema.parse(body);

    const result = await acceptOrgInvite(db, { token, otpCode, userId, userEmail });

    // Reason -> HTTP status, matching apps/admin's app/api/join/route.ts
    // exactly (both call the same acceptOrgInvite — packages/db/src/invites.ts).
    if (!result.ok) {
      switch (result.reason) {
        case 'invalid_token': return c.json({ data: null, error: result.reason, meta: null }, 404);
        case 'expired': return c.json({ data: null, error: result.reason, meta: null }, 410);
        case 'email_mismatch': return c.json({ data: null, error: result.reason, meta: null }, 403);
        case 'otp_required': return c.json({ data: null, error: result.reason, meta: null }, 400);
        case 'otp_invalid': return c.json({ data: null, error: result.reason, meta: null }, 400);
        case 'otp_expired': return c.json({ data: null, error: result.reason, meta: null }, 410);
        case 'otp_locked': return c.json({ data: null, error: result.reason, meta: null }, 429);
      }
    }

    return c.json({ data: jsonSafe({ orgId: result.orgId, role: result.role }), error: null, meta: null }, 201);
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
