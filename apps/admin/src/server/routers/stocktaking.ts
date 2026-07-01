import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { stocktakingSessions, stocktakingItems } from '@irth/db';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const stocktakingRouter = router({
  sessions: router({
    list: protectedProcedure
      .input(z.object({}).optional())
      .query(async ({ ctx }) => {
        const sessions = await ctx.db
          .select()
          .from(stocktakingSessions)
          .where(eq(stocktakingSessions.orgId, ctx.orgId))
          .orderBy(desc(stocktakingSessions.createdAt))
          .limit(50);

        const sessionsWithCounts = await Promise.all(
          sessions.map(async (s) => {
            const [counts] = await ctx.db
              .select({
                itemCount: count(stocktakingItems.id),
                varianceCount: sql<number>`COALESCE(COUNT(CASE WHEN ${stocktakingItems.variance} != 0 AND ${stocktakingItems.actualQuantity} IS NOT NULL THEN 1 END), 0)`,
              })
              .from(stocktakingItems)
              .where(eq(stocktakingItems.sessionId, s.id));
            return {
              ...s,
              itemCount: Number(counts?.itemCount ?? 0),
              varianceCount: Number(counts?.varianceCount ?? 0),
            };
          })
        );

        return { data: sessionsWithCounts, error: null };
      }),

    create: protectedProcedure
      .input(z.object({ notes: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const [session] = await ctx.db
          .insert(stocktakingSessions)
          .values({
            orgId: ctx.orgId,
            status: 'in_progress',
            startedAt: new Date(),
            notes: input.notes ?? null,
          })
          .returning();
        return { data: session, error: null };
      }),

    complete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [session] = await ctx.db
          .update(stocktakingSessions)
          .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(stocktakingSessions.id, input.id),
              eq(stocktakingSessions.orgId, ctx.orgId)
            )
          )
          .returning();
        if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
        return { data: session, error: null };
      }),

    getItems: protectedProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const items = await ctx.db
          .select()
          .from(stocktakingItems)
          .where(
            and(
              eq(stocktakingItems.sessionId, input.sessionId),
              eq(stocktakingItems.orgId, ctx.orgId)
            )
          )
          .orderBy(stocktakingItems.productName);
        return { data: items, error: null };
      }),
  }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    // ⚡ Bolt: Replaced materializing all sessions in memory with an optimized database aggregation query to improve latency and reduce memory usage.
    const [result] = await ctx.db
      .select({
        totalSessions: count(),
        activeSessions: sql<number>`COALESCE(SUM(CASE WHEN ${stocktakingSessions.status} = 'in_progress' THEN 1 ELSE 0 END), 0)::integer`,
        lastCompletedAt: sql<Date | null>`MAX(CASE WHEN ${stocktakingSessions.status} = 'completed' THEN ${stocktakingSessions.completedAt} ELSE NULL END)`,
      })
      .from(stocktakingSessions)
      .where(eq(stocktakingSessions.orgId, ctx.orgId));

    return {
      data: {
        totalSessions: result?.totalSessions ?? 0,
        activeSessions: result?.activeSessions ?? 0,
        lastCompletedAt: result?.lastCompletedAt ?? null,
      },
      error: null,
    };
  }),
});