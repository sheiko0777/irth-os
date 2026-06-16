import { handleError } from "../utils/errors";
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { organizations, orgMembers, orgInvites, withAudit } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middlewares/requireRole';
// import { Resend } from 'resend'; // Assume resend is installed, or we handle it

export const orgsRouter = new Hono();

// We expect user to be authenticated and have user id in context 
// (assuming auth middleware sets it or we extract from headers/auth handler)
// For simplicity we will read user_id from headers if present, or "unknown"

const createOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

orgsRouter.post('/', async (c: Context) => {
  try {
    const body = await c.req.json();
    const { name, slug } = createOrgSchema.parse(body);
    // Identity comes from the verified session (authContext), never the client.
    const userId = c.get('userId') as string | undefined;
    if (!userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const org = await withAudit(db, async () => {
      const [insertedOrg] = await db.insert(organizations).values({ name, slug }).returning();
      await db.insert(orgMembers).values({
        orgId: insertedOrg.id,
        userId,
        role: 'owner',
      });
      return insertedOrg;
    }, {
      orgId: 'system', // the newly created org will have its own id, but it doesn't exist yet for the root audit orgId. Alternatively, use insertedOrg.id later if the withAudit function allowed it.
      userId,
      action: 'CREATE_ORG',
      tableName: 'organizations',
      changes: { name, slug }
    });

    return c.json({ data: org, error: null, meta: null }, 201);
  } catch (error: unknown) {
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
    return c.json({ data: members, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.string().default('member'),
});

orgsRouter.post('/:id/invite', requireRole('owner', 'admin'), async (c: Context) => {
  try {
    const id = c.req.param('id');
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    if (id !== orgId) return c.json({ data: null, error: 'Forbidden', meta: null }, 403);

    const body = await c.req.json();
    const { email, role } = inviteSchema.parse(body);

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

    // Mock sending email
    // const resend = new Resend(process.env.RESEND_API_KEY);
    // await resend.emails.send({ ... subject: `دعوة للانضمام إلى ${org.name}` ... })
    console.log(`Sending email to ${email} with subject: دعوة للانضمام إلى ${org.name}`);

    return c.json({ data: invite, error: null, meta: null }, 201);
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

    return c.json({ data: member, error: null, meta: null }, 201);
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

    const result = await withAudit(db, async () => {
      const [updated] = await db.update(orgMembers)
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
    });

    if (!result) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    return c.json({ data: result, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});
