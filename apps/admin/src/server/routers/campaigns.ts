import { z } from 'zod';
import { router, requirePermission } from '../trpc';
import { campaigns, campaignRecipients, snapshotAndEnqueueCampaign, UnresolvedSegmentError, paginationOffset, paginationMeta } from '@irth/db';
import { paginationInputSchema } from '../pagination';
import { eq, and, desc, count, sql, or, ne } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const campaignsRouter = router({
  list: requirePermission('campaigns', 'view')
    .input(z.object(paginationInputSchema(100)))
    .query(async ({ ctx, input }) => {
      const offset = paginationOffset(input.page, input.pageSize);
      const [rows, totalResult] = await Promise.all([
        ctx.db
          .select()
          .from(campaigns)
          .where(eq(campaigns.orgId, ctx.orgId))
          .orderBy(desc(campaigns.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        ctx.db
          .select({ count: count() })
          .from(campaigns)
          .where(eq(campaigns.orgId, ctx.orgId)),
      ]);
      return {
        data: rows,
        error: null,
        meta: paginationMeta(input.page, input.pageSize, totalResult[0]?.count ?? 0),
      };
    }),

  summary: requirePermission('campaigns', 'view').query(async ({ ctx }) => {
    // ⚡ Bolt: Replaced O(N) memory allocation and array methods with a single database aggregate query
    // This resolves potential OOM errors and reduces CPU load when returning many campaigns.
    const [result] = await ctx.db
      .select({
        total: count(campaigns.id),
        sent: sql<number>`COALESCE(SUM(CASE WHEN ${campaigns.status} = 'sent' THEN 1 ELSE 0 END), 0)::integer`,
        inProgress: sql<number>`COALESCE(SUM(CASE WHEN ${campaigns.status} IN ('sending', 'scheduled') THEN 1 ELSE 0 END), 0)::integer`,
        totalDelivered: sql<number>`COALESCE(SUM(${campaigns.deliveredCount}), 0)::integer`,
      })
      .from(campaigns)
      .where(eq(campaigns.orgId, ctx.orgId));

    return {
      data: {
        total: result?.total || 0,
        sent: result?.sent || 0,
        inProgress: result?.inProgress || 0,
        totalDelivered: result?.totalDelivered || 0
      },
      error: null
    };
  }),

  create: requirePermission('campaigns', 'write')
    .input(
      z.object({
        name: z.string().min(1),
        message: z.string().min(1),
        channel: z.enum(['whatsapp', 'sms', 'email']).default('whatsapp'),
        targetSegment: z.enum(['all', 'vip', 'inactive', 'new', 'custom']).default('all'),
        scheduledAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [campaign] = await ctx.withOrg(async (tx) => tx
        .insert(campaigns)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          message: input.message,
          channel: input.channel,
          targetSegment: input.targetSegment,
          status: input.scheduledAt ? 'scheduled' : 'draft',
          scheduledAt: input.scheduledAt ?? null,
        })
        .returning());
      return { data: campaign, error: null };
    }),

  send: requirePermission('campaigns', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // The draft/scheduled guard lives in the WHERE clause: checking first and
      // updating after lets two concurrent sends both observe 'draft' and both
      // transition the campaign, which downstream means the dispatch worker can
      // send the same blast to customers twice.
      // Mark as sending — actual dispatch handled by outbox/360dialog worker
      let campaign;
      try {
        [campaign] = await ctx.withOrg(async (tx) => {
          const [updated] = await tx
            .update(campaigns)
            .set({ status: 'sending', sentAt: new Date(), updatedAt: new Date() })
            .where(and(
              eq(campaigns.id, input.id),
              eq(campaigns.orgId, ctx.orgId),
              or(eq(campaigns.status, 'draft'), eq(campaigns.status, 'scheduled')),
            ))
            .returning();

          if (updated) {
            await snapshotAndEnqueueCampaign(tx, updated);
          }

          return [updated];
        });
      } catch (e) {
        if (e instanceof UnresolvedSegmentError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: e.message });
        }
        throw e;
      }

      if (!campaign) {
        const [existing] = await ctx.db
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(and(eq(campaigns.id, input.id), eq(campaigns.orgId, ctx.orgId)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Campaign already sent or sending' });
      }

      return { data: campaign, error: null };
    }),

  cancel: requirePermission('campaigns', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [campaign] = await ctx.withOrg(async (tx) => {
        const [updated] = await tx
          .update(campaigns)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(and(
            eq(campaigns.id, input.id),
            eq(campaigns.orgId, ctx.orgId),
            or(eq(campaigns.status, 'scheduled'), eq(campaigns.status, 'sending')),
          ))
          .returning();
        
        if (updated) {
           await tx.update(campaignRecipients)
              .set({ status: 'skipped_cancelled', updatedAt: new Date() })
              .where(and(
                eq(campaignRecipients.campaignId, updated.id),
                eq(campaignRecipients.orgId, ctx.orgId),
                eq(campaignRecipients.status, 'pending')
              ));
        }

        return [updated];
      });

      if (!campaign) {
         throw new TRPCError({ code: 'BAD_REQUEST', message: 'Campaign cannot be cancelled' });
      }

      return { data: campaign, error: null };
    }),

  delete: requirePermission('campaigns', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.id, input.id), eq(campaigns.orgId, ctx.orgId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      // Two fixes in one statement. The DELETE had no orgId predicate at all —
      // only the SELECT above was scoped, so the check and the delete were
      // separate statements guarding a destructive write. And the 'sending'
      // guard is re-asserted here rather than trusted from that SELECT, so a
      // campaign that starts sending in between is not deleted mid-flight.
      const [deleted] = await ctx.withOrg(async (tx) =>
        tx.delete(campaigns)
          .where(and(
            eq(campaigns.id, input.id),
            eq(campaigns.orgId, ctx.orgId),
            ne(campaigns.status, 'sending'),
          ))
          .returning({ id: campaigns.id }),
      );

      if (!deleted) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete a campaign in progress' });
      }

      return { success: true };
    }),
});