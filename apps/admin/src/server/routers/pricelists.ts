import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { priceLists, priceListItems } from '@irth/db';
import { eq, and, desc, count } from 'drizzle-orm';

export const pricelistsRouter = router({
  list: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const lists = await ctx.db
        .select()
        .from(priceLists)
        .where(eq(priceLists.orgId, ctx.orgId))
        .orderBy(desc(priceLists.createdAt));

      const listsWithCounts = await Promise.all(
        lists.map(async (pl) => {
          const [{ cnt }] = await ctx.db
            .select({ cnt: count(priceListItems.id) })
            .from(priceListItems)
            .where(eq(priceListItems.priceListId, pl.id));
          return {
            ...pl,
            itemCount: Number(cnt ?? 0),
            // Stored as integer basis points; surfaced as a percent for display.
            // 1000 bp -> 10. Integer division by 100 keeps the tenth of a
            // percent that bp can express without going through a float.
            discountPercent: pl.discountBp === null ? null : pl.discountBp / 100,
          };
        })
      );

      return listsWithCounts;
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
          // Percent in, basis points stored. Math.round is safe here: the input
          // is a rate bounded to 0..100, not money, and bp is the integer
          // representation the CHECK constraint enforces.
          discountBp: input.discountPercent === undefined ? null : Math.round(input.discountPercent * 100),
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