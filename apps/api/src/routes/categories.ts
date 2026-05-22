import { handleError } from "../utils/errors";
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { categories, withAudit } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middlewares/requireRole';

export const categoriesRouter = new Hono();

categoriesRouter.get('/', async (c: Context) => {
  try {
    const orgId = c.req.header('org_id');
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const data = await db.select().from(categories).where(eq(categories.orgId, orgId));

    return c.json({ data, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  parentId: z.string().uuid().optional(),
});

categoriesRouter.post('/', requireRole('owner', 'admin'), async (c: Context) => {
  try {
    const orgId = c.req.header('org_id');
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const userId = c.req.header('user_id') || 'system';
    const body = await c.req.json();
    const data = createCategorySchema.parse(body);

    const result = await withAudit(db, async () => {
      const [inserted] = await db.insert(categories).values({
        orgId,
        ...data,
      }).returning();
      return inserted;
    }, {
      orgId,
      userId,
      action: 'CREATE_CATEGORY',
      tableName: 'categories',
      changes: data
    });

    return c.json({ data: result, error: null, meta: null }, 201);
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

categoriesRouter.delete('/:id', requireRole('owner'), async (c: Context) => {
  try {
    const orgId = c.req.header('org_id');
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const id = c.req.param('id');
    if (!id) return c.json({ data: null, error: 'Invalid ID', meta: null }, 400);
    const userId = c.req.header('user_id') || 'system';

    const result = await withAudit(db, async () => {
      const [deleted] = await db.delete(categories).where(and(
        eq(categories.id, id),
        eq(categories.orgId, orgId)
      )).returning();
      return deleted;
    }, {
      orgId,
      userId,
      action: 'DELETE_CATEGORY',
      tableName: 'categories',
      changes: { id }
    });

    if (!result) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    return c.json({ data: result, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});
