import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { stocktakingSessions, stocktakingItems } from '@irth/db';
import { eq, and, desc, count, sql, inArray } from 'drizzle-orm';
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

        if (sessions.length === 0) {
          return { data: [], error: null };
        }

        const sessionIds = sessions.map((s) => s.id);

        const counts = await ctx.db
          .select({
            sessionId: stocktakingItems.sessionId,
            itemCount: count(stocktakingItems.id),
            varianceCount: sql<number>`COALESCE(COUNT(CASE WHEN ${stocktakingItems.variance} != 0 AND ${stocktakingItems.actualQuantity} IS NOT NULL THEN 1 END), 0)`,
          })
          .from(stocktakingItems)
          .where(inArray(stocktakingItems.sessionId, sessionIds))
          .groupBy(stocktakingItems.sessionId);

        const countsMap = new Map<string, { itemCount: number; varianceCount: number }>();
        for (const row of counts) {
          if (row.sessionId) {
            countsMap.set(row.sessionId, {
              itemCount: Number(row.itemCount),
              varianceCount: Number(row.varianceCount),
            });
          }
        }

        const sessionsWithCounts = sessions.map((s) => {
          const c = countsMap.get(s.id);
          return {
            ...s,
            itemCount: c?.itemCount ?? 0,
            varianceCount: c?.varianceCount ?? 0,
          };
        });

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
    const allSessions = await ctx.db
      .select({
        status: stocktakingSessions.status,
        completedAt: stocktakingSessions.completedAt,
      })
      .from(stocktakingSessions)
      .where(eq(stocktakingSessions.orgId, ctx.orgId));

    const totalSessions = allSessions.length;
    const activeSessions = allSessions.filter((s) => s.status === 'in_progress').length;
    const completed = allSessions.filter((s) => s.status === 'completed' && s.completedAt);
    const lastCompletedAt =
      completed.length > 0
        ? completed.reduce((a, b) => (a.completedAt! > b.completedAt! ? a : b)).completedAt
        : null;

    return { data: { totalSessions, activeSessions, lastCompletedAt }, error: null };
  }),
});
