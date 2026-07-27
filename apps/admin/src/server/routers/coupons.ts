import { z } from 'zod';
import { router, protectedProcedure, adminProcedure, ownerProcedure } from '../trpc';
import { db, coupons, withAudit } from '@irth/db';
import { eq, and, desc, sql, or, isNull, lt, gt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const couponsRouter = router({
    list: protectedProcedure
        .input(z.object({
            page: z.number().min(1).default(1),
            pageSize: z.number().min(1).max(100).default(10),
        }))
        .query(async ({ ctx, input }) => {
            const limit = input.pageSize;
            const offset = (input.page - 1) * input.pageSize;

            const results = await db.select()
                .from(coupons)
                .where(eq(coupons.orgId, ctx.orgId))
                .limit(limit)
                .offset(offset)
                .orderBy(desc(coupons.createdAt));

            const totalResult = await db.select({ count: sql<number>`count(*)` })
                .from(coupons)
                .where(eq(coupons.orgId, ctx.orgId));

            return {
                items: results,
                total: Number(totalResult[0]?.count || 0),
            };
        }),

    get: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            const result = await db.select()
                .from(coupons)
                .where(and(eq(coupons.id, input.id), eq(coupons.orgId, ctx.orgId)))
                .limit(1);
            if (!result.length) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Coupon not found' });
            }
            return result[0];
        }),

    create: adminProcedure
        .input(z.object({
            code: z.string().min(1).transform(s => s.toUpperCase()),
            type: z.enum(['percentage', 'fixed', 'free_shipping']),
            value: z.number().min(0),
            minOrderAmount: z.number().min(0).optional().nullable(),
            maxUses: z.number().int().min(1).optional().nullable(),
            expiresAt: z.date().optional().nullable(),
            description: z.string().optional().nullable(),
        }))
        .mutation(async ({ ctx, input }) => {
            return withAudit(db, async () => {
                const result = await db.insert(coupons)
                    .values({
                        orgId: ctx.orgId,
                        code: input.code,
                        type: input.type,
                        value: input.value.toString(),
                        minOrderAmount: input.minOrderAmount?.toString(),
                        maxUses: input.maxUses ?? null,
                        expiresAt: input.expiresAt ?? null,
                        description: input.description ?? null,
                    })
                    .returning();
                return result[0];
            }, {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'create_coupon',
                tableName: 'coupons',
                changes: input,
            });
        }),

    update: adminProcedure
        .input(z.object({
            id: z.string().uuid(),
            code: z.string().min(1).transform(s => s.toUpperCase()).optional(),
            type: z.enum(['percentage', 'fixed', 'free_shipping']).optional(),
            value: z.number().min(0).optional(),
            minOrderAmount: z.number().min(0).optional().nullable(),
            maxUses: z.number().int().min(1).optional().nullable(),
            expiresAt: z.date().optional().nullable(),
            description: z.string().optional().nullable(),
        }))
        .mutation(async ({ ctx, input }) => {
            return withAudit(db, async () => {
                const { id, ...updateData } = input;
                const formattedData: Record<string, unknown> = { ...updateData };
                if (input.value !== undefined) formattedData.value = input.value.toString();
                if (input.minOrderAmount !== undefined) formattedData.minOrderAmount = input.minOrderAmount?.toString() ?? null;
                formattedData.updatedAt = new Date();

                const result = await db.update(coupons)
                    .set(formattedData)
                    .where(and(eq(coupons.id, id), eq(coupons.orgId, ctx.orgId)))
                    .returning();
                if (!result.length) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Coupon not found' });
                }
                return result[0];
            }, {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'update_coupon',
                tableName: 'coupons',
                changes: input,
            });
        }),

    toggleActive: adminProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            return withAudit(db, async () => {
                const coupon = await db.select({ isActive: coupons.isActive })
                    .from(coupons)
                    .where(and(eq(coupons.id, input.id), eq(coupons.orgId, ctx.orgId)))
                    .limit(1);

                if (!coupon.length) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Coupon not found' });
                }

                const result = await db.update(coupons)
                    .set({ isActive: !coupon[0].isActive, updatedAt: new Date() })
                    .where(and(eq(coupons.id, input.id), eq(coupons.orgId, ctx.orgId)))
                    .returning();
                return result[0];
            }, {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'toggle_coupon_active',
                tableName: 'coupons',
                changes: { id: input.id },
            });
        }),

    delete: ownerProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            return withAudit(db, async () => {
                const result = await db.delete(coupons)
                    .where(and(eq(coupons.id, input.id), eq(coupons.orgId, ctx.orgId)))
                    .returning();
                if (!result.length) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Coupon not found' });
                }
                return result[0];
            }, {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'delete_coupon',
                tableName: 'coupons',
                changes: { id: input.id },
            });
        }),

    validate: protectedProcedure
        .input(z.object({
            code: z.string().transform(s => s.toUpperCase()),
            orderAmount: z.number().min(0),
        }))
        .query(async ({ ctx, input }) => {
            const result = await db.select()
                .from(coupons)
                .where(and(eq(coupons.code, input.code), eq(coupons.orgId, ctx.orgId)))
                .limit(1);

            if (!result.length) {
                return { valid: false, error: 'invalid_code', discount: 0, discountType: null, couponId: null };
            }

            const coupon = result[0];

            if (!coupon.isActive) {
                return { valid: false, error: 'inactive', discount: 0, discountType: null, couponId: null };
            }

            if (coupon.expiresAt && new Date() > coupon.expiresAt) {
                return { valid: false, error: 'expired', discount: 0, discountType: null, couponId: null };
            }

            if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
                return { valid: false, error: 'max_uses_reached', discount: 0, discountType: null, couponId: null };
            }

            if (coupon.minOrderAmount && input.orderAmount < Number(coupon.minOrderAmount)) {
                return { valid: false, error: 'min_amount_not_met', discount: 0, discountType: null, couponId: null };
            }

            let discount = 0;
            const value = Number(coupon.value);

            if (coupon.type === 'percentage') {
                discount = (input.orderAmount * value) / 100;
            } else if (coupon.type === 'fixed') {
                discount = value;
            } else if (coupon.type === 'free_shipping') {
                discount = value; // We return value for free shipping as well, could be 0, the type indicates it.
            }

            return {
                valid: true,
                discount: discount > input.orderAmount ? input.orderAmount : discount,
                discountType: coupon.type,
                couponId: coupon.id,
                error: null
            };
        }),

    // Named `redeem` — `apply` is a reserved word in tRPC v11 router({})
    // and made the whole appRouter throw at import.
    redeem: adminProcedure
        .input(z.object({
            couponId: z.string().uuid(),
            orderId: z.string().uuid().optional(), // For auditing if needed
        }))
        .mutation(async ({ ctx, input }) => {
            return withAudit(db, async () => {
                // `validate` is a separate query, so its checks are stale by the
                // time this runs — and this mutation is callable without it.
                // Re-assert redeemability inside the UPDATE's WHERE so the check
                // and the increment cannot be split: without this an expired,
                // deactivated, or fully-used coupon still increments and reports
                // success, and concurrent redemptions blow past maxUses.
                const result = await db.update(coupons)
                    .set({
                        usedCount: sql`used_count + 1`,
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(coupons.id, input.couponId),
                        eq(coupons.orgId, ctx.orgId),
                        eq(coupons.isActive, true),
                        or(isNull(coupons.expiresAt), gt(coupons.expiresAt, new Date())),
                        or(isNull(coupons.maxUses), lt(coupons.usedCount, coupons.maxUses)),
                    ))
                    .returning();

                if (!result.length) {
                    // Distinguish "no such coupon" from "not redeemable" only
                    // after the atomic attempt has already failed.
                    const [existing] = await db.select({ id: coupons.id })
                        .from(coupons)
                        .where(and(eq(coupons.id, input.couponId), eq(coupons.orgId, ctx.orgId)))
                        .limit(1);
                    if (!existing) {
                        throw new TRPCError({ code: 'NOT_FOUND', message: 'Coupon not found' });
                    }
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Coupon is not redeemable (inactive, expired, or usage limit reached)',
                    });
                }

                return result[0];
            }, {
                orgId: ctx.orgId,
                userId: ctx.userId,
                action: 'apply_coupon',
                tableName: 'coupons',
                changes: { couponId: input.couponId, orderId: input.orderId },
            });
        }),
});
