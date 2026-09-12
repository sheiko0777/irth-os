import { router, protectedProcedure } from '../trpc';
import { notifications, paginationOffset } from '@irth/db';
import { paginationInputSchema } from '../pagination';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

export const notificationsRouter = router({
    list: protectedProcedure
        .input(z.object(paginationInputSchema(20, 50)))
        .query(async ({ ctx, input }) => {
            const { page, pageSize } = input;
            const offset = paginationOffset(page, pageSize);

            const [rows, totals] = await Promise.all([
                ctx.db
                    .select()
                    .from(notifications)
                    .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId)))
                    .orderBy(desc(notifications.createdAt))
                    .limit(pageSize)
                    .offset(offset),
                ctx.db
                    .select({
                        total:  sql<number>`count(*)::int`,
                        unread: sql<number>`count(*) filter (where ${notifications.read} = false)::int`,
                    })
                    .from(notifications)
                    .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId))),
            ]);

            const { total, unread } = totals[0] ?? { total: 0, unread: 0 };
            return { data: { items: rows, total, unread }, error: null, meta: null };
        }),

    markRead: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            await ctx.withOrg(async (tx) => tx
                .update(notifications)
                .set({ read: true })
                .where(and(eq(notifications.id, input.id), eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId))));
            return { data: { ok: true }, error: null, meta: null };
        }),

    markAllRead: protectedProcedure
        .mutation(async ({ ctx }) => {
            await ctx.withOrg(async (tx) => tx
                .update(notifications)
                .set({ read: true })
                .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId), eq(notifications.read, false))));
            return { data: { ok: true }, error: null, meta: null };
        }),

    unreadCount: protectedProcedure
        .query(async ({ ctx }) => {
            const rows = await ctx.db
                .select({ count: sql<number>`count(*)::int` })
                .from(notifications)
                .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId), eq(notifications.read, false)));
            return { data: { count: rows[0]?.count ?? 0 }, error: null, meta: null };
        }),
});
