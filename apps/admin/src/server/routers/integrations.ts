import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { db } from '@irth/db';
import { outboxEvents } from '@irth/db';
import { desc, eq, and } from 'drizzle-orm';

export const integrationsRouter = router({
    outboxList: protectedProcedure
        .input(z.object({ showProcessed: z.boolean().default(false) }))
        .query(async ({ ctx, input }) => {
            const orgId = ctx.session.user.orgId;

            if (!orgId) {
                return {
                    data: [],
                    error: "No active organization",
                    meta: null
                };
            }

            const conditions = [eq(outboxEvents.orgId, orgId)];

            if (!input.showProcessed) {
                conditions.push(eq(outboxEvents.processed, false));
            }

            try {
                const events = await db.select()
                    .from(outboxEvents)
                    .where(and(...conditions))
                    .orderBy(desc(outboxEvents.createdAt))
                    .limit(50);

                return {
                    data: events,
                    error: null,
                    meta: null
                };
            } catch (error) {
                return {
                    data: [],
                    error: "Failed to fetch outbox events",
                    meta: null
                };
            }
        }),
});
