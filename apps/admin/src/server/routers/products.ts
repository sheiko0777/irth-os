import { router, protectedProcedure } from '../trpc';
import { products, productVariants, brandEnum } from '@irth/db';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withAudit } from '@irth/db';

export const productsRouter = router({
    list: protectedProcedure
        .input(z.object({
            page: z.number().default(1),
            pageSize: z.number().default(20),
        }))
        .query(async ({ ctx, input }) => {
            const { page, pageSize } = input;
            const offset = (page - 1) * pageSize;

            const conditions = [eq(products.orgId, ctx.orgId)];

            const data = await ctx.db
                .select({
                    id: products.id,
                    nameAr: products.nameAr,
                    nameEn: products.nameEn,
                    category: products.category,
                    brand: products.brand,
                    isActive: products.isActive,
                    variantsCount: count(productVariants.id)
                })
                .from(products)
                .leftJoin(productVariants, eq(products.id, productVariants.productId))
                .where(and(...conditions))
                .groupBy(products.id)
                .orderBy(desc(products.createdAt))
                .limit(pageSize)
                .offset(offset);

            const totalQuery = await ctx.db
                .select({ count: count() })
                .from(products)
                .where(and(...conditions));

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

    getById: protectedProcedure
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
                .where(and(
                    eq(productVariants.productId, product.id),
                    eq(productVariants.orgId, ctx.orgId)
                ));

            return {
                data: { product, variants },
                error: null,
                meta: null
            };
        }),

    create: protectedProcedure
        .input(z.object({
            nameAr: z.string().min(1),
            nameEn: z.string().min(1),
            description: z.string().optional(),
            category: z.string().min(1),
            brand: z.enum(brandEnum.enumValues).default('irth'),
            variants: z.array(z.object({
                sku: z.string().min(1),
                price: z.string().or(z.number()),
                stock: z.number().int().min(0)
            })).optional()
        }))
        .mutation(async ({ ctx, input }) => {
            const result = await withAudit(
                ctx.db,
                async () => {
                    return await ctx.db.transaction(async (tx: any) => {
                        const [product] = await tx.insert(products)
                            .values({
                                orgId: ctx.orgId,
                                nameAr: input.nameAr,
                                nameEn: input.nameEn,
                                category: input.category,
                                description: input.description,
                                brand: input.brand,
                            })
                            .returning();

                        if (input.variants && input.variants.length > 0) {
                            await tx.insert(productVariants)
                                .values(input.variants.map(v => ({
                                    orgId: ctx.orgId,
                                    productId: product.id,
                                    sku: v.sku,
                                    price: typeof v.price === 'number' ? v.price.toString() : v.price,
                                    stock: v.stock
                                })));
                        }
                        return product;
                    });
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'CREATE_PRODUCT',
                    tableName: 'products',
                    changes: input
                }
            );

            return { data: result, error: null, meta: null };
        }),

    update: protectedProcedure
        .input(z.object({
            id: z.string().uuid(),
            nameAr: z.string().min(1),
            nameEn: z.string().min(1),
            category: z.string().min(1),
            description: z.string().optional(),
            isActive: z.boolean()
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

            const result = await withAudit(
                ctx.db,
                async () => {
                    const [updated] = await ctx.db.update(products)
                        .set({
                            nameAr: input.nameAr,
                            nameEn: input.nameEn,
                            category: input.category,
                            description: input.description,
                            isActive: input.isActive,
                            updatedAt: new Date()
                        })
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
            );

            return { data: result, error: null, meta: null };
        }),

    deactivate: protectedProcedure
        .input(z.object({
            id: z.string().uuid()
        }))
        .mutation(async ({ ctx, input }) => {
            const result = await withAudit(
                ctx.db,
                async () => {
                    const [updated] = await ctx.db.update(products)
                        .set({ isActive: false, updatedAt: new Date() })
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
                    changes: { isActive: false }
                }
            );

            return { data: result, error: null, meta: null };
        }),
});
