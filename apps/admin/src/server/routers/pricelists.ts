import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { priceLists, priceListItems } from '@irth/db';
import { eq, and, desc, count } from 'drizzle-orm';

export const pricelistsRouter = router({
  list: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const listsWithCounts = await ctx.db
        .select({
          id: priceLists.id,
          orgId: priceLists.orgId,
          name: priceLists.name,
          description: priceLists.description,
          currency: priceLists.currency,
          discountPercent: priceLists.discountPercent,
          isDefault: priceLists.isDefault,
          customerGroupId: priceLists.customerGroupId,
          startDate: priceLists.startDate,
          endDate: priceLists.endDate,
          createdAt: priceLists.createdAt,
          updatedAt: priceLists.updatedAt,
          cnt: count(priceListItems.id),
        })
        .from(priceLists)
        .leftJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
        .where(eq(priceLists.orgId, ctx.orgId))
        .groupBy(priceLists.id)
        .orderBy(desc(priceLists.createdAt));

      return listsWithCounts.map(({ cnt, ...pl }) => ({
        ...pl,
        itemCount: Number(cnt ?? 0),
        discountPercent: pl.discountPercent ? Number(pl.discountPercent) : null,
      }));
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        currency: z.string().default('EGP'),
        discountPercent: z.number().min(0).max(100).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [pl] = await ctx.db
        .insert(priceLists)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          description: input.description ?? null,
          currency: input.currency,
          discountPercent: input.discountPercent?.toString() ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
        })
        .returning();
      return pl;
    }),

  delete: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(priceLists)
        .where(and(eq(priceLists.id, input.id), eq(priceLists.orgId, ctx.orgId)));
      return { success: true };
    }),

  getItems: protectedProcedure
    .input(z.object({ pricelistId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db
        .select()
        .from(priceListItems)
        .where(
          and(
            eq(priceListItems.priceListId, input.pricelistId),
            eq(priceListItems.orgId, ctx.orgId)
          )
        );
      return items;
    }),
});
