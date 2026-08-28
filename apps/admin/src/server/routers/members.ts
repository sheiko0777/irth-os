import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { eq, and } from 'drizzle-orm';
import { orgMembers, orgInvites, user, withAudit } from '@irth/db';
import { TRPCError } from '@trpc/server';

export const membersRouter = router({
  // List members of the active org (owner/admin only — matrix: members.view).
  list: requirePermission('members', 'view').query(async ({ ctx }) => {
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

  // Invite a new member to the active org (owner/admin only — matrix: members.invite).
  //
  // This used to be a client-side fetch() straight to the Workers API
  // (apps/api's `orgsRouter.post('/:id/invite', ...)`), cross-origin from
  // app.irth-house.com to irth-api.*.workers.dev. That could never work: the
  // two apps run separate Better Auth instances on unrelated domains, so the
  // admin session cookie set for app.irth-house.com is never sent to a
  // workers.dev origin no matter what CORS/credentials config the fetch
  // carries — cookies are domain-scoped, not something a client can forward
  // across origins. Same-origin tRPC, reusing the request's own session
  // (already verified by `protectedProcedure`/`adminProcedure`), is the actual
  // fix — not a CORS tweak.
  invite: requirePermission('members', 'invite')
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['owner', 'admin', 'member']).default('member'),
    }))
    .mutation(async ({ ctx, input }) => {
      // Mirrors apps/api's own check: an admin may invite members and other
      // admins, but only an owner may invite a new owner.
      if (ctx.role === 'admin' && input.role === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only an owner can invite another owner.' });
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invite = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [row] = await tx
            .insert(orgInvites)
            .values({ orgId: ctx.orgId, email: input.email, token, role: input.role, expiresAt })
            .returning();
          return row;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'INVITE_MEMBER',
          tableName: 'org_invites',
          changes: { email: input.email, role: input.role },
        },
      ));

      // Invite email delivery is not wired up yet (matches apps/api's route).
      return { data: invite, error: null, meta: null };
    }),

  // Change a member's role (owner only — matrix: members.changeRole).
  changeRole: requirePermission('members', 'changeRole')
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

      const updated = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [row] = await tx
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
      ));

      return { data: updated, error: null, meta: null };
    }),
});
