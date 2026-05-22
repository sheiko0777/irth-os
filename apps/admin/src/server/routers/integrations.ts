import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { outboxEvents } from '@irth/db';
import { desc, eq, and } from 'drizzle-orm';

export const integrationsRouter = router({
    outboxList: protectedProcedure
        .input(z.object({ showProcessed: z.boolean().default(false) }))
        .query(async ({ ctx, input }) => {
            const baseCondition = eq(outboxEvents.orgId, ctx.orgId);
            const whereClause = input.showProcessed
                ? baseCondition
                : and(baseCondition, eq(outboxEvents.processed, false));

            const events = await ctx.db
                .select()
                .from(outboxEvents)
                .where(whereClause)
                .orderBy(desc(outboxEvents.createdAt))
                .limit(50);

            return { data: events, error: null, meta: null };
        }),
});
