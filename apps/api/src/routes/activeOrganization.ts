import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { orgMembers } from '@irth/db';
import { getDb } from '../db';
import { ACTIVE_ORGANIZATION_COOKIE, isOrganizationId } from '@irth/db';

export const activeOrganizationRoute = new Hono();
const bodySchema = z.object({ organizationId: z.string().uuid() });

activeOrganizationRoute.post('/', async (c) => {
  const userId = c.get('userId') as string | undefined;
  if (!userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ data: null, error: 'Invalid JSON', meta: null }, 400); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isOrganizationId(parsed.data.organizationId)) {
    return c.json({ data: null, error: 'Invalid organizationId', meta: null }, 400);
  }

  const [membership] = await getDb().select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, parsed.data.organizationId)))
    .limit(1);
  if (!membership) return c.json({ data: null, error: 'Organization access denied', meta: null }, 403);

  const secure = c.env?.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';
  const cookie = `${ACTIVE_ORGANIZATION_COOKIE}=${encodeURIComponent(membership.orgId)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  c.header('Set-Cookie', cookie);
  return c.json({ data: { organizationId: membership.orgId }, error: null, meta: null });
});

activeOrganizationRoute.delete('/', async (c) => {
  const userId = c.get('userId') as string | undefined;
  if (!userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  c.header('Set-Cookie', `${ACTIVE_ORGANIZATION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return c.json({ data: null, error: null, meta: null });
});
