import { z } from 'zod';
import { router, requirePermission } from '../trpc';
import { outboxDeadLetters, outboxEvents } from '@irth/db';
import { eq, and, desc } from 'drizzle-orm';

/**
 * Recovery surface for `outbox_dead_letters` (see #333): a row lands there
 * once an outbox event exhausts OUTBOX_MAX_ATTEMPTS, for every event type,
 * with no way back until now. `replayedAt`/`replayedBy` existed on the
 * schema from the start for exactly this — this is what finally reads and
 * writes them.
 *
 * `integrations.recover` (owner and admin by default), matching the bar this
 * codebase already sets for other manual-retry ops actions (eta.ts's
 * submit/cancel/submitPending) — a replay can re-trigger a real external side
 * effect (send an email, push to Shopify), the same reason those are not
 * open to every role.
 */
export const deadLettersRouter = router({
    list: requirePermission('integrations', 'recover')
        .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
        .query(async ({ ctx, input }) => {
            const rows = await ctx.db
                .select()
                .from(outboxDeadLetters)
                .where(eq(outboxDeadLetters.orgId, ctx.orgId))
                .orderBy(desc(outboxDeadLetters.failedAt))
                .limit(input?.limit ?? 50);
            return { data: rows, error: null, meta: null };
        }),

    replay: requirePermission('integrations', 'recover')
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const [letter] = await ctx.db
                .select()
                .from(outboxDeadLetters)
                .where(and(eq(outboxDeadLetters.id, input.id), eq(outboxDeadLetters.orgId, ctx.orgId)))
                .limit(1);
            if (!letter) return { data: null, error: 'Dead letter not found', meta: null };
            // Idempotent from the caller's side: a double-click re-plays
            // nothing a second time rather than silently re-queuing twice.
            if (letter.replayedAt) return { data: null, error: 'Already replayed', meta: null };

            // Both writes commit together: a crash between them must not
            // leave a re-queued event whose dead letter still reads as
            // "not yet replayed" (which would let it be replayed again),
            // nor a marked-replayed letter whose event never actually
            // re-entered the queue.
            await ctx.withOrg(async (tx) => {
                await tx.insert(outboxEvents).values({
                    orgId: ctx.orgId,
                    eventType: letter.eventType,
                    payload: letter.payload,
                    // Fresh attempt count — this is a new try, not a
                    // continuation of the run that exhausted the original.
                });
                await tx.update(outboxDeadLetters)
                    .set({ replayedAt: new Date(), replayedBy: ctx.userId })
                    .where(and(eq(outboxDeadLetters.id, letter.id), eq(outboxDeadLetters.orgId, ctx.orgId)));
            });

            return { data: { requeued: true }, error: null, meta: null };
        }),
});
