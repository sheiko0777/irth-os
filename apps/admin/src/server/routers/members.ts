import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { eq, and } from 'drizzle-orm';
import { orgMembers } from '@irth/db';
import { TRPCError } from '@trpc/server';

export const membersRouter = router({
  changeRole: protectedProcedure
    .input(z.object({
      memberId: z.string().uuid(),
      role: z.enum(['admin', 'member']),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(orgMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(orgMembers.id, input.memberId),
            eq(orgMembers.orgId, ctx.orgId),
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      }

      return { data: updated, error: null, meta: null };
    }),
});
