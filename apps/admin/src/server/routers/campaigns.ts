import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { campaigns } from '@irth/db';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const campaignsRouter = router({
  list: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(campaigns)
        .where(eq(campaigns.orgId, ctx.orgId))
        .orderBy(desc(campaigns.createdAt))
        .limit(100);
      return { data: rows, error: null };
    }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ status: campaigns.status, deliveredCount: campaigns.deliveredCount, totalRecipients: campaigns.totalRecipients })
      .from(campaigns)
      .where(eq(campaigns.orgId, ctx.orgId));

    const total = rows.length;
    const sent = rows.filter((r) => r.status === 'sent').length;
    const inProgress = rows.filter((r) => r.status === 'sending' || r.status === 'scheduled').length;
    const totalDelivered = rows.reduce((sum, r) => sum + r.deliveredCount, 0);

    return { data: { total, sent, inProgress, totalDelivered }, error: null };
  }),

  create: protectedProcedure
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
      const [campaign] = await ctx.db
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
        .returning();
      return { data: campaign, error: null };
    }),

  send: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, input.id), eq(campaigns.orgId, ctx.orgId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
      if (existing.status !== 'draft' && existing.status !== 'scheduled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Campaign already sent or sending' });
      }

      // Mark as sending — actual dispatch handled by outbox/360dialog worker
      const [campaign] = await ctx.db
        .update(campaigns)
        .set({ status: 'sending', sentAt: new Date(), updatedAt: new Date() })
        .where(eq(campaigns.id, input.id))
        .returning();

      return { data: campaign, error: null };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.id, input.id), eq(campaigns.orgId, ctx.orgId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (existing.status === 'sending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete a campaign in progress' });
      }

      await ctx.db.delete(campaigns).where(eq(campaigns.id, input.id));
      return { success: true };
    }),
});