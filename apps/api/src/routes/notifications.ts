import { handleError } from "../utils/errors";
import { Hono } from 'hono';
import { db } from '../db';
import { notifications, activityLog, jsonSafe } from '@irth/db';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';

export const notificationsRouter = new Hono();

// GET / - List unread notifications for current user
notificationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = (c.get('userId') as string | undefined) ?? 'system';

  if (!orgId) {
    return c.json({ error: 'Missing org_id header', data: null, meta: null }, 401);
  }

  try {
    const data = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.read, false)
      ))
      .orderBy(desc(notifications.createdAt));

    return c.json({ data: jsonSafe(data), error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ error: handleError(error), data: null, meta: null }, 500);
  }
});

// PATCH /:id/read - Mark single notification as read
notificationsRouter.patch('/:id/read', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = (c.get('userId') as string | undefined) ?? 'system';
  const notificationId = c.req.param('id');

  if (!orgId) {
    return c.json({ error: 'Missing org_id header', data: null, meta: null }, 401);
  }

  try {
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId)
      ))
      .returning();

    if (result.length === 0) {
      return c.json({ error: 'Notification not found', data: null, meta: null }, 404);
    }

    return c.json({ data: jsonSafe(result[0]), error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ error: handleError(error), data: null, meta: null }, 500);
  }
});

// PATCH /read-all - Mark all unread as read
notificationsRouter.patch('/read-all', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = (c.get('userId') as string | undefined) ?? 'system';

  if (!orgId) {
    return c.json({ error: 'Missing org_id header', data: null, meta: null }, 401);
  }

  try {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.read, false)
      ));

    return c.json({ data: jsonSafe({ success: true }), error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ error: handleError(error), data: null, meta: null }, 500);
  }
});

const activityQuerySchema = z.object({
  page: z.string().optional().default('1').transform(val => parseInt(val, 10)),
  limit: z.string().optional().default('20').transform(val => parseInt(val, 10)),
});

// GET /activity - List activity log entries (paginated)
notificationsRouter.get('/activity', async (c) => {
  const orgId = c.get('orgId') as string | undefined;

  if (!orgId) {
    return c.json({ error: 'Missing org_id header', data: null, meta: null }, 401);
  }

  try {
    const query = activityQuerySchema.parse(c.req.query());
    const offset = (query.page - 1) * query.limit;

    const data = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.orgId, orgId))
      .orderBy(desc(activityLog.createdAt))
      .limit(query.limit)
      .offset(offset);

    return c.json({
      data: jsonSafe(data),
      error: null,
      meta: { page: query.page, limit: query.limit }
    });
  } catch (error: unknown) {
    return c.json({ error: handleError(error), data: null, meta: null }, 500);
  }
});
