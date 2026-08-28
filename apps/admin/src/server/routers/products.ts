import { router, requirePermission } from '../trpc';
import { products, productVariants, categories, brandEnum } from '@irth/db';
import { eq, and, desc, sql, count, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withAudit } from '@irth/db';
import { EGP, parseDecimal } from '@irth/domain';

export const productsRouter = router({
    list: requirePermission('products', 'view')
        .input(z.object({
            page: z.number().default(1),
            pageSize: z.number().default(20),
            q: z.string().optional(),
            status: z.string().optional()
        }))
        .query(async ({ ctx, input }) => {
            const { page, pageSize, q, status } = input;
            const offset = (page - 1) * pageSize;

            const conditions = [eq(products.orgId, ctx.orgId)];
            if (q) {
                conditions.push(ilike(products.name, `%${q}%`));
            }
            if (status && status !== 'all') {
                conditions.push(eq(products.status, status));
            }

            // Execute list and count queries concurrently to reduce latency
            const [data, totalQuery] = await Promise.all([
                ctx.db
                    .select({
                        id: products.id,
                        name: products.name,
                        sku: products.sku,
                        priceMinor: products.priceMinor,
                        stock: products.stock,
                        status: products.status,
                        category: categories.name,
                        brand: products.brand,
                    })
                    .from(products)
                    .leftJoin(categories, eq(products.categoryId, categories.id))
                    .where(and(...conditions))
                    .orderBy(desc(products.createdAt))
                    .limit(pageSize)
                    .offset(offset),
                ctx.db
                    .select({ count: count() })
                    .from(products)
                    .where(and(...conditions))
            ]);

            return {
                data,
                error: null,
                meta: {
                    total: totalQuery[0].count,
                    page,
                    pageSize,
                }
            };
        }),

    getById: requirePermission('products', 'view')
        .input(z.object({
            id: z.string().uuid()
        }))
        .query(async ({ ctx, input }) => {
            const product = await ctx.db.query.products.findFirst({
                where: and(
                    eq(products.id, input.id),
                    eq(products.orgId, ctx.orgId)
                )
            });

            if (!product) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

            const variants = await ctx.db
                .select()
                .from(productVariants)
                .where(eq(productVariants.productId, product.id));

            return {
                data: { product, variants },
                error: null,
                meta: null
            };
        }),

    create: requirePermission('products', 'write')
        .input(z.object({
            name: z.string().min(1),
            nameAr: z.string().optional(),
            sku: z.string().min(1),
            categoryId: z.string().uuid().optional(),
            description: z.string().optional(),
            descriptionAr: z.string().optional(),
            price: z.string().or(z.number()),
            currency: z.string().default('USD'),
            stock: z.number().int().min(0),
            status: z.string().default('active'),
            brand: z.enum(brandEnum.enumValues).default('irth'),
        }))
        .mutation(async ({ ctx, input }) => {
            const priceMinor = parseDecimal(String(input.price), EGP).minor;

            const result = await ctx.withOrg((tx) => withAudit(
                tx,
                async () => {
                    const [product] = await tx.insert(products)
                        .values({
                            orgId: ctx.orgId,
                            name: input.name,
                            nameAr: input.nameAr,
                            sku: input.sku,
                            categoryId: input.categoryId,
                            description: input.description,
                            descriptionAr: input.descriptionAr,
                            priceMinor,
                            currency: input.currency,
                            stock: input.stock,
                            status: input.status,
                            brand: input.brand,
                        })
                        .returning();

                    return product;
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'CREATE_PRODUCT',
                    tableName: 'products',
                    changes: input
                }
            ));

            return { data: result, error: null, meta: null };
        }),

    update: requirePermission('products', 'write')
        .input(z.object({
            id: z.string().uuid(),
            name: z.string().min(1).optional(),
            nameAr: z.string().optional(),
            sku: z.string().min(1).optional(),
            categoryId: z.string().uuid().optional().nullable(),
            description: z.string().optional(),
            descriptionAr: z.string().optional(),
            price: z.string().or(z.number()).optional(),
            currency: z.string().optional(),
            stock: z.number().int().optional(),
            status: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const product = await ctx.db.query.products.findFirst({
                where: and(
                    eq(products.id, input.id),
                    eq(products.orgId, ctx.orgId)
                )
            });

            if (!product) {
                throw new TRPCError({ code: 'NOT_FOUND' });
            }

            const { id: _id, ...rest } = input;
            const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
            if (input.price !== undefined) {
               updateData.priceMinor = parseDecimal(String(input.price), EGP).minor;
            }

            const result = await ctx.withOrg((tx) => withAudit(
                tx,
                async () => {
                    const [updated] = await tx.update(products)
                        .set(updateData)
                        .where(and(
                            eq(products.id, input.id),
                            eq(products.orgId, ctx.orgId)
                        ))
                        .returning();
                    return updated;
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'UPDATE_PRODUCT',
                    tableName: 'products',
                    changes: input
                }
            ));

            return { data: result, error: null, meta: null };
        }),

    deactivate: requirePermission('products', 'delete')
        .input(z.object({
            id: z.string().uuid()
        }))
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.withOrg((tx) => withAudit(
                tx,
                async () => {
                    const [updated] = await tx.update(products)
                        .set({ status: 'archived', updatedAt: new Date() })
                        .where(and(
                            eq(products.id, input.id),
                            eq(products.orgId, ctx.orgId)
                        ))
                        .returning();
                    
                    if (!updated) {
                         throw new TRPCError({ code: 'NOT_FOUND' });
                    }
                    return updated;
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'DEACTIVATE_PRODUCT',
                    tableName: 'products',
                    changes: { status: 'archived' }
                }
            ));

            return { data: result, error: null, meta: null };
        }),
});

