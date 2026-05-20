import { Hono } from 'hono';
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
orgsRouter.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const { name, slug } = createOrgSchema.parse(body);
        // Dummy user ID for now since we don't have full auth setup context here yet
        // In real app, we'd get this from Better Auth context
        const userId = c.req.header('user_id') || 'system';
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
    }
    catch (error) {
        return c.json({ data: null, error: error instanceof Error ? error.message : String(error), meta: null }, 400);
    }
});
orgsRouter.get('/:id/members', async (c) => {
    try {
        const id = c.req.param('id');
        const orgId = c.req.header('org_id') || id; // enforce org_id rule if header is present
        if (id !== orgId && c.req.header('org_id')) {
            return c.json({ data: null, error: 'Unauthorized', meta: null }, 403);
        }
        const members = await db.select().from(orgMembers).where(eq(orgMembers.orgId, id));
        return c.json({ data: members, error: null, meta: null });
    }
    catch (error) {
        return c.json({ data: null, error: error instanceof Error ? error.message : String(error), meta: null }, 400);
    }
});
const inviteSchema = z.object({
    email: z.string().email(),
    role: z.string().default('member'),
});
orgsRouter.post('/:id/invite', requireRole('owner', 'admin'), async (c) => {
    try {
        const id = c.req.param('id');
        const orgId = c.req.header('org_id') || id;
        if (id !== orgId && c.req.header('org_id')) {
            return c.json({ data: null, error: 'Unauthorized', meta: null }, 403);
        }
        const body = await c.req.json();
        const { email, role } = inviteSchema.parse(body);
        const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
        if (!org) {
            return c.json({ data: null, error: 'Organization not found', meta: null }, 404);
        }
        const token = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now
        const [invite] = await db.insert(orgInvites).values({
            orgId: id,
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
    }
    catch (error) {
        return c.json({ data: null, error: error instanceof Error ? error.message : String(error), meta: null }, 400);
    }
});
const acceptInviteSchema = z.object({
    token: z.string(),
    userId: z.string(), // We need to know who is accepting it
});
orgsRouter.post('/invite/accept', async (c) => {
    try {
        const body = await c.req.json();
        const { token, userId } = acceptInviteSchema.parse(body);
        const [invite] = await db.select().from(orgInvites).where(and(eq(orgInvites.token, token), eq(orgInvites.orgId, c.req.header("org_id") || "system")));
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
        await db.delete(orgInvites).where(and(eq(orgInvites.id, invite.id), eq(orgInvites.orgId, invite.orgId)));
        return c.json({ data: member, error: null, meta: null }, 201);
    }
    catch (error) {
        return c.json({ data: null, error: error instanceof Error ? error.message : String(error), meta: null }, 400);
    }
});
const updateRoleSchema = z.object({
    role: z.enum(['owner', 'admin', 'member']),
});
orgsRouter.patch('/members/:memberId/role', requireRole('owner'), async (c) => {
    try {
        const orgId = c.req.header('org_id');
        const memberId = c.req.param('memberId');
        if (!orgId)
            return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
        const body = await c.req.json();
        const { role } = updateRoleSchema.parse(body);
        const userId = c.req.header('user_id') || 'system';
        const result = await withAudit(db, async () => {
            const [updated] = await db.update(orgMembers)
                .set({ role })
                .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId))).returning();
            return updated;
        }, {
            orgId,
            userId,
            action: 'UPDATE_MEMBER_ROLE',
            tableName: 'org_members',
            changes: { role }
        });
        if (!result)
            return c.json({ data: null, error: 'Not Found', meta: null }, 404);
        return c.json({ data: result, error: null, meta: null });
    }
    catch (error) {
        return c.json({ data: null, error: error instanceof Error ? error.message : String(error), meta: null }, 400);
    }
});
