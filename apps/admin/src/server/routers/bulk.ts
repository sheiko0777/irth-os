import { router, protectedProcedure, adminProcedure } from '../trpc';
import { orders, customers, inventoryItems, productVariants, products, orderStatusEnum, withAudit } from '@irth/db';
import { inArray, and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

export const bulkRouter = router({
    bulkUpdateOrderStatus: adminProcedure
        .input(z.object({
            ids: z.array(z.string().uuid()).min(1).max(100),
            status: z.enum(orderStatusEnum.enumValues),
        }))
        .mutation(async ({ ctx, input }) => {
            const { ids, status } = input;
            await ctx.withOrg((tx) => withAudit(
                tx,
                async () => {
                    await tx
                        .update(orders)
                        .set({ status })
                        .where(and(inArray(orders.id, ids), eq(orders.orgId, ctx.orgId)));
                    return { id: ids[0]! };
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'bulk_update_status',
                    tableName: 'orders',
                    changes: { ids, newStatus: status },
                }
            ));
            return { data: { updated: ids.length }, error: null, meta: null };
        }),

    exportOrders: protectedProcedure
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
            status: z.enum(orderStatusEnum.enumValues).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const { startDate, endDate, status } = input;
            const conditions = [
                eq(orders.orgId, ctx.orgId),
                gte(orders.createdAt, new Date(startDate)),
                lte(orders.createdAt, new Date(endDate)),
            ];
            if (status) conditions.push(eq(orders.status, status));

            const rows = await ctx.db
                .select({
                    orderNumber: orders.orderNumber,
                    customerName: customers.name,
                    status: orders.status,
                    totalAmountMinor: orders.totalAmountMinor,
                    createdAt: orders.createdAt,
                    paymentMethod: sql<string>`''`,
                })
                .from(orders)
                .leftJoin(customers, eq(orders.customerId, customers.id))
                .where(and(...conditions))
                .limit(5000);

            return { data: rows, error: null, meta: null };
        }),

    exportInventory: protectedProcedure
        .query(async ({ ctx }) => {
            const rows = await ctx.db
                .select({
                    productName: products.name,
                    variantName: productVariants.name,
                    sku: productVariants.sku,
                    quantity: inventoryItems.quantity,
                    reorderPoint: inventoryItems.reorderPoint,
                    isLow: sql<boolean>`${inventoryItems.quantity} <= ${inventoryItems.reorderPoint}`,
                })
                .from(inventoryItems)
                .innerJoin(productVariants, eq(inventoryItems.variantId, productVariants.id))
                .innerJoin(products, eq(productVariants.productId, products.id))
                .where(eq(inventoryItems.orgId, ctx.orgId));

            return { data: rows, error: null, meta: null };
        }),

    exportCustomers: protectedProcedure
        .query(async ({ ctx }) => {
            const rows = await ctx.db
                .select({
                    name: customers.name,
                    email: customers.email,
                    phone: customers.phone,
                    loyaltyPoints: customers.loyaltyPoints,
                    totalOrders: customers.totalOrders,
                    totalSpentMinor: customers.totalSpentMinor,
                    createdAt: customers.createdAt,
                })
                .from(customers)
                .where(eq(customers.orgId, ctx.orgId))
                .limit(5000);

            return { data: rows, error: null, meta: null };
        }),
});

