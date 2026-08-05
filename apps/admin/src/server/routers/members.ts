import { z } from 'zod';
import { adminProcedure, ownerProcedure, router } from '../trpc';
import { eq, and } from 'drizzle-orm';
import { orgMembers, user, withAudit } from '@irth/db';
import { TRPCError } from '@trpc/server';

export const membersRouter = router({
  // List members of the active org (owner/admin only — matrix: members.view).
  list: adminProcedure.query(async ({ ctx }) => {
    // Joined to `user` because org_members only stores the id. Returning the
    // bare row made the members table render a 32-character auth id where the
    // person's name belongs, which is unreadable and unsearchable.
    //
    // leftJoin, not innerJoin: a membership whose user record is missing is a
    // data problem worth seeing in the UI, not a row to silently drop.
    const members = await ctx.db
      .select({
        id: orgMembers.id,
        userId: orgMembers.userId,
        role: orgMembers.role,
        createdAt: orgMembers.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(orgMembers)
      .leftJoin(user, eq(user.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, ctx.orgId));

    return { data: members, error: null, meta: { orgId: ctx.orgId } };
  }),

  // Change a member's role (owner only — matrix: members.changeRole).
  changeRole: ownerProcedure
    .input(z.object({
      memberId: z.string().uuid(),
      role: z.enum(['admin', 'member']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Load the target row, scoped to the caller's org.
      const [target] = await ctx.db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      }

      // Owner protection: the owner's role cannot be changed through this path.
      if (target.role === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change the owner role.' });
      }

      // Self-change guard: a user cannot change their own role.
      if (target.userId === ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot change your own role.' });
      }

      const updated = await withAudit(
        ctx.db,
        async () => {
          const [row] = await ctx.db
            .update(orgMembers)
            .set({ role: input.role })
            .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
            .returning();
          return row;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'CHANGE_MEMBER_ROLE',
          tableName: 'org_members',
          changes: { memberId: input.memberId, from: target.role, to: input.role },
        },
      );

      return { data: updated, error: null, meta: null };
    }),
});
