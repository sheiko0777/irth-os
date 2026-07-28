import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { customerSegments, customerSegmentMembers, customers } from '@irth/db';
import { eq, and, desc, count, inArray, not } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const customerSegmentsRouter = router({
  list: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const segments = await ctx.db
        .select({
          id: customerSegments.id,
          name: customerSegments.name,
          color: customerSegments.color,
          description: customerSegments.description,
          createdAt: customerSegments.createdAt,
          memberCount: count(customerSegmentMembers.id),
        })
        .from(customerSegments)
        .leftJoin(
          customerSegmentMembers,
          eq(customerSegmentMembers.segmentId, customerSegments.id)
        )
        .where(eq(customerSegments.orgId, ctx.orgId))
        .groupBy(customerSegments.id)
        .orderBy(desc(customerSegments.createdAt));

      return { data: segments, error: null };
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        color: z.string().default('#B0885E'),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [segment] = await ctx.db
        .insert(customerSegments)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          color: input.color,
          description: input.description ?? null,
        })
        .returning();
      return { data: segment, error: null };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        color: z.string().optional(),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const [updated] = await ctx.db
        .update(customerSegments)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(eq(customerSegments.id, id), eq(customerSegments.orgId, ctx.orgId)))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
      return { data: updated, error: null };
    }),

  delete: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(customerSegments)
        .where(and(eq(customerSegments.id, input.id), eq(customerSegments.orgId, ctx.orgId)))
        .returning();
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
      return { data: deleted, error: null };
    }),

  getMembers: protectedProcedure
    .input(z.object({ segmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const seg = await ctx.db
        .select({ id: customerSegments.id })
        .from(customerSegments)
        .where(and(eq(customerSegments.id, input.segmentId), eq(customerSegments.orgId, ctx.orgId)))
        .limit(1);
      if (!seg.length) throw new TRPCError({ code: 'NOT_FOUND' });

      const members = await ctx.db
        .select({
          memberId: customerSegmentMembers.id,
          customerId: customerSegmentMembers.customerId,
          addedAt: customerSegmentMembers.addedAt,
          customerName: customers.name,
          customerEmail: customers.email,
          customerPhone: customers.phone,
        })
        .from(customerSegmentMembers)
        .innerJoin(customers, eq(customers.id, customerSegmentMembers.customerId))
        .where(eq(customerSegmentMembers.segmentId, input.segmentId))
        .orderBy(desc(customerSegmentMembers.addedAt));

      return { data: members, error: null };
    }),

  addMembers: adminProcedure
    .input(z.object({ segmentId: z.string().uuid(), customerIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const seg = await ctx.db
        .select({ id: customerSegments.id })
        .from(customerSegments)
        .where(and(eq(customerSegments.id, input.segmentId), eq(customerSegments.orgId, ctx.orgId)))
        .limit(1);
      if (!seg.length) throw new TRPCError({ code: 'NOT_FOUND' });

      await ctx.db
        .insert(customerSegmentMembers)
        .values(
          input.customerIds.map((cid) => ({
            orgId: ctx.orgId,
            segmentId: input.segmentId,
            customerId: cid,
          }))
        )
        .onConflictDoNothing();

      return { data: { added: input.customerIds.length }, error: null };
    }),

  removeMember: adminProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(customerSegmentMembers)
        .where(
          and(
            eq(customerSegmentMembers.id, input.memberId),
            eq(customerSegmentMembers.orgId, ctx.orgId)
          )
        )
        .returning();
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND' });
      return { data: deleted, error: null };
    }),

  getCustomersNotInSegment: protectedProcedure
    .input(z.object({ segmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const memberIds = await ctx.db
        .select({ customerId: customerSegmentMembers.customerId })
        .from(customerSegmentMembers)
        .where(eq(customerSegmentMembers.segmentId, input.segmentId));

      const excludeIds = memberIds.map((m) => m.customerId);

      const rows = excludeIds.length
        ? await ctx.db
            .select({ id: customers.id, name: customers.name, email: customers.email })
            .from(customers)
            .where(and(eq(customers.orgId, ctx.orgId), not(inArray(customers.id, excludeIds))))
            .orderBy(customers.name)
            .limit(200)
        : await ctx.db
            .select({ id: customers.id, name: customers.name, email: customers.email })
            .from(customers)
            .where(eq(customers.orgId, ctx.orgId))
            .orderBy(customers.name)
            .limit(200);

      return { data: rows, error: null };
    }),
});
