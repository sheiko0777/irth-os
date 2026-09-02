import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { eq, and, desc } from 'drizzle-orm';
import { orgMembers, orgInvites, organizations, user, withAudit, emitOutboxEvent, generateInviteOtp } from '@irth/db';
import { TRPCError } from '@trpc/server';
import { accessProfiles } from '@irth/db';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// 'ar' matches apps/admin/src/i18n/routing.ts's defaultLocale — hardcoded
// rather than imported from there, deliberately: that module's export also
// runs next-intl's createNavigation(), which is fine in real Next.js
// requests but hangs when a test dynamically imports a router that pulls it
// in transitively (confirmed: rbac.test.ts's `await import(...)` of this
// file timed out until this import was removed). Server-side code has no
// business importing client-navigation helpers to read one string.
const DEFAULT_LOCALE = 'ar';

function joinUrlFor(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${appUrl}/${DEFAULT_LOCALE}/join?token=${token}`;
}

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
        accessProfileId: orgMembers.accessProfileId,
        jobTitle: orgMembers.jobTitle,
        assignedWarehouseIds: orgMembers.assignedWarehouseIds,
        profileName: accessProfiles.name,
        createdAt: orgMembers.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(orgMembers)
      .leftJoin(user, eq(user.id, orgMembers.userId))
      .leftJoin(accessProfiles, eq(accessProfiles.id, orgMembers.accessProfileId))
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
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const { code: otpCode, expiresAt: otpExpiresAt } = generateInviteOtp();

      const invite = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [org] = await tx.select({ name: organizations.name }).from(organizations)
            .where(eq(organizations.id, ctx.orgId)).limit(1);
          const [row] = await tx
            .insert(orgInvites)
            .values({ orgId: ctx.orgId, email: input.email, token, role: input.role, expiresAt, otpCode, otpExpiresAt })
            .returning();
          await emitOutboxEvent(tx, {
            orgId: ctx.orgId,
            eventType: 'org.invite.sent',
            payload: {
              orgId: ctx.orgId, inviteId: row.id, email: input.email, orgName: org?.name ?? '',
              role: input.role, otpCode, joinUrl: joinUrlFor(token),
            },
          });
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

      return { data: invite, error: null, meta: null };
    }),

  // Every pending invite for the active org (owner/admin only — same view
  // boundary as the member list itself).
  listInvites: requirePermission('members', 'view').query(async ({ ctx }) => {
    const invites = await ctx.db
      .select()
      .from(orgInvites)
      .where(eq(orgInvites.orgId, ctx.orgId))
      .orderBy(desc(orgInvites.createdAt));

    return { data: invites, error: null, meta: null };
  }),

  // Reissues an existing invite in place — new token, new OTP, new expiry,
  // re-sent through the same outbox path as a fresh invite. Folded under
  // `members.invite` rather than a new permission action: inviting and
  // re-inviting share the same trust boundary today.
  //
  // Deliberately does NOT reset otpAttempts to 0 — see resend-otp/route.ts's
  // equivalent comment. Reusing the row (UPDATE, not delete+insert) keeps
  // id/createdAt stable for the pending-invites list.
  resendInvite: requirePermission('members', 'invite')
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(orgInvites)
        .where(and(eq(orgInvites.id, input.inviteId), eq(orgInvites.orgId, ctx.orgId))).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });

      const newToken = crypto.randomUUID();
      const newExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const { code: otpCode, expiresAt: otpExpiresAt } = generateInviteOtp();

      const updated = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [org] = await tx.select({ name: organizations.name }).from(organizations)
            .where(eq(organizations.id, ctx.orgId)).limit(1);
          const [row] = await tx.update(orgInvites)
            .set({ token: newToken, expiresAt: newExpiresAt, otpCode, otpExpiresAt })
            .where(and(eq(orgInvites.id, input.inviteId), eq(orgInvites.orgId, ctx.orgId)))
            .returning();
          await emitOutboxEvent(tx, {
            orgId: ctx.orgId,
            eventType: 'org.invite.sent',
            payload: {
              orgId: ctx.orgId, inviteId: row.id, email: row.email, orgName: org?.name ?? '',
              role: row.role, otpCode, joinUrl: joinUrlFor(newToken),
            },
          });
          return row;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'RESEND_INVITE',
          tableName: 'org_invites',
          changes: { inviteId: input.inviteId },
        },
      ));

      return { data: updated, error: null, meta: null };
    }),

  // Hard delete — org_invites has no revoked/cancelled state (see migration
  // history), so revoking and "used up" both mean the row is gone. Scoped by
  // id AND orgId, unlike platformAdmin.ts's own revokeInvite (which trusts
  // platformAdminProcedure's cross-tenant grant): a tenant-facing mutation
  // must not let an admin delete another org's invite by guessing a UUID.
  revokeInvite: requirePermission('members', 'invite')
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [row] = await tx.delete(orgInvites)
            .where(and(eq(orgInvites.id, input.inviteId), eq(orgInvites.orgId, ctx.orgId)))
            .returning();
          return row;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'REVOKE_INVITE',
          tableName: 'org_invites',
          changes: { inviteId: input.inviteId },
        },
      ));
      if (!revoked) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });

      return { data: { revoked: true }, error: null, meta: null };
    }),

  // Invite up to 50 addresses at once, all at the same role. One transaction
  // PER invite, not one shared transaction for the whole batch: Postgres
  // aborts the entire transaction on an uncaught statement error, and an
  // admin who pastes 20 emails wants the other 19 sent if one is malformed,
  // not a full rollback.
  bulkInvite: requirePermission('members', 'invite')
    .input(z.object({
      emails: z.array(z.string().email()).min(1).max(50),
      role: z.enum(['owner', 'admin', 'member']).default('member'),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.role === 'admin' && input.role === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only an owner can invite another owner.' });
      }

      const results: { email: string; ok: boolean; error?: string }[] = [];

      for (const email of input.emails) {
        try {
          const token = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
          const { code: otpCode, expiresAt: otpExpiresAt } = generateInviteOtp();

          await ctx.withOrg((tx) => withAudit(
            tx,
            async () => {
              const [org] = await tx.select({ name: organizations.name }).from(organizations)
                .where(eq(organizations.id, ctx.orgId)).limit(1);
              const [row] = await tx
                .insert(orgInvites)
                .values({ orgId: ctx.orgId, email, token, role: input.role, expiresAt, otpCode, otpExpiresAt })
                .returning();
              await emitOutboxEvent(tx, {
                orgId: ctx.orgId,
                eventType: 'org.invite.sent',
                payload: {
                  orgId: ctx.orgId, inviteId: row.id, email, orgName: org?.name ?? '',
                  role: input.role, otpCode, joinUrl: joinUrlFor(token),
                },
              });
              return row;
            },
            {
              orgId: ctx.orgId,
              userId: ctx.userId,
              action: 'INVITE_MEMBER',
              tableName: 'org_invites',
              changes: { email, role: input.role },
            },
          ));
          results.push({ email, ok: true });
        } catch (err) {
          results.push({ email, ok: false, error: err instanceof Error ? err.message : 'unknown error' });
        }
      }

      return { data: { invited: results.filter((r) => r.ok).length, results }, error: null, meta: null };
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

  // Remove a member from the active org (owner only — matrix: members.remove).
  // Hard delete: org_members has no soft-delete column, and nothing in the
  // schema or any migration references org_members.id via foreign key —
  // confirmed by a full grep — so there is no downstream display need a
  // soft delete would protect. The audit trail lives in audit_log (below),
  // not in the row itself. Guards mirror changeRole's exactly.
  remove: requirePermission('members', 'remove')
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      }

      if (target.role === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove the owner.' });
      }

      if (target.userId === ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot remove yourself.' });
      }

      const removed = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [row] = await tx
            .delete(orgMembers)
            .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
            .returning();
          return row;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'REMOVE_MEMBER',
          tableName: 'org_members',
          changes: { memberId: input.memberId, removedUserId: target.userId, role: target.role },
        },
      ));

      return { data: removed, error: null, meta: null };
    }),
});
