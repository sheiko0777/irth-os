import { handleError } from "../utils/errors";
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { products, productVariants, withAudit } from '@irth/db';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { requireRole } from '../middlewares/requireRole';

export const productsRouter = new Hono();

productsRouter.get('/', async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const category = c.req.query('category');
    const status = c.req.query('status');
    const q = c.req.query('q');

    const offset = (page - 1) * limit;

    const conditions = [eq(products.orgId, orgId)];
    if (category) conditions.push(eq(products.categoryId, category));
    if (status) conditions.push(eq(products.status, status));
    if (q) conditions.push(ilike(products.name, `%${q}%`));

    const whereClause = and(...conditions);

    const data = await db.select().from(products).where(whereClause).limit(limit).offset(offset).orderBy(desc(products.createdAt));
    
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(products).where(whereClause);
    const total = Number(countResult[0].count);

    return c.json({ data, error: null, meta: { total, page, limit } });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const createProductSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1),
  nameAr: z.string().optional(),
  sku: z.string().min(1),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  price: z.number().or(z.string()),
  currency: z.string().default('USD'),
  stock: z.number().int().default(0),
  status: z.string().default('active'),
  images: z.array(z.any()).default([]),
});

productsRouter.post('/', requireRole('owner', 'admin'), async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const userId = (c.get('userId') as string | undefined) ?? 'system';
    const body = await c.req.json();
    const data = createProductSchema.parse(body);

    const priceStr = typeof data.price === 'number' ? data.price.toString() : data.price;

    const result = await withAudit(db, async () => {
      const [inserted] = await db.insert(products).values({
        orgId,
        ...data,
        price: priceStr,
      }).returning();
      return inserted;
    }, {
      orgId,
      userId,
      action: 'CREATE_PRODUCT',
      tableName: 'products',
      changes: data
    });

    return c.json({ data: result, error: null, meta: null }, 201);
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

productsRouter.get('/:id', async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
    
    const id = c.req.param('id');
    if (!id) return c.json({ data: null, error: 'Invalid ID', meta: null }, 400);

    const product = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.orgId, orgId))
    });

    if (!product) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id));

    return c.json({ data: { product, variants }, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const updateProductSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
  nameAr: z.string().optional(),
  sku: z.string().min(1).optional(),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  price: z.number().or(z.string()).optional(),
  currency: z.string().optional(),
  stock: z.number().int().optional(),
  status: z.string().optional(),
  images: z.array(z.any()).optional(),
});

productsRouter.patch('/:id', requireRole('owner', 'admin'), async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const id = c.req.param('id');
    if (!id) return c.json({ data: null, error: 'Invalid ID', meta: null }, 400);
    const userId = (c.get('userId') as string | undefined) ?? 'system';
    const body = await c.req.json();
    const data = updateProductSchema.parse(body);

    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.price !== undefined) {
       updateData.price = typeof data.price === 'number' ? data.price.toString() : data.price;
    }

    const result = await withAudit(db, async () => {
      const [updated] = await db.update(products)
        .set(updateData)
        .where(and(eq(products.id, id), eq(products.orgId, orgId)))
        .returning();
      return updated;
    }, {
      orgId,
      userId,
      action: 'UPDATE_PRODUCT',
      tableName: 'products',
      changes: data
    });

    if (!result) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    return c.json({ data: result, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

productsRouter.delete('/:id', requireRole('owner'), async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const id = c.req.param('id');
    if (!id) return c.json({ data: null, error: 'Invalid ID', meta: null }, 400);
    const userId = (c.get('userId') as string | undefined) ?? 'system';

    const result = await withAudit(db, async () => {
      const [updated] = await db.update(products)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.orgId, orgId)))
        .returning();
      return updated;
    }, {
      orgId,
      userId,
      action: 'DELETE_PRODUCT',
      tableName: 'products',
      changes: { status: 'archived' }
    });

    if (!result) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    return c.json({ data: result, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

productsRouter.get('/:id/variants', async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const id = c.req.param('id');
    if (!id) return c.json({ data: null, error: 'Invalid ID', meta: null }, 400);
    
    // First ensure product exists and belongs to org
    const product = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.orgId, orgId))
    });

    if (!product) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    const data = await db.select().from(productVariants).where(eq(productVariants.productId, id));

    return c.json({ data, error: null, meta: null });
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

const createVariantSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().or(z.string()).optional(),
  stock: z.number().int().default(0),
  attributes: z.any().default({}),
});

productsRouter.post('/:id/variants', requireRole('owner', 'admin'), async (c: Context) => {
  try {
    const orgId = c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

    const id = c.req.param('id');
    if (!id) return c.json({ data: null, error: 'Invalid ID', meta: null }, 400);
    const userId = (c.get('userId') as string | undefined) ?? 'system';
    
    // Verify product exists for org
    const product = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.orgId, orgId))
    });

    if (!product) return c.json({ data: null, error: 'Not Found', meta: null }, 404);

    const body = await c.req.json();
    const data = createVariantSchema.parse(body);

    const priceStr = data.price !== undefined ? (typeof data.price === 'number' ? data.price.toString() : data.price) : undefined;

    const result = await withAudit(db, async () => {
      const [inserted] = await db.insert(productVariants).values({
        productId: id,
        ...data,
        price: priceStr || null,
      }).returning();
      return inserted;
    }, {
      orgId,
      userId,
      action: 'CREATE_PRODUCT_VARIANT',
      tableName: 'product_variants',
      changes: data
    });

    return c.json({ data: result, error: null, meta: null }, 201);
  } catch (error: unknown) {
    return c.json({ data: null, error: handleError(error), meta: null }, 400);
  }
});

