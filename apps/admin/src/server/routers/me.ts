import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { and, eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { account, listMembershipsForUser, orgMembers, setActiveOrg, NotAMemberError, withAudit } from '@irth/db';

/**
 * The caller's own identity and membership.
 *
 * Exists because the client had no way to learn its role. `useRole()` read it
 * from the Better Auth session (`user.role`, `session.activeOrganizationRole`),
 * but Better Auth never puts it there — this app keeps roles in `org_members`,
 * and only the server derived it. So useRole() returned null for everyone,
 * PermissionGate rendered nothing, and every gated control was invisible to
 * all users including owners.
 *
 * createContext already resolves orgId and role per request, so this just
 * surfaces what it computed. It is not an authorization decision: the server
 * procedures (requirePermission) remain the enforcement point.
 * This only tells the UI which affordances are worth drawing.
 */
export const meRouter = router({
    get: protectedProcedure.query(async ({ ctx }) => ({
        data: {
            userId: ctx.userId,
            orgId: ctx.orgId,
            role: ctx.role,
            principalKind: ctx.access.principalKind,
            // Effective "resource.action" keys — role plus per-person
            // overrides — so the UI hides exactly what the server refuses.
            permissions: [...ctx.access.perms].sort(),
            // An account on a temporary password (PR-1d): the UI sends it to
            // the change-password page; the server refuses everything else.
            mustChangePassword: ctx.access.mustChangePassword,
            orgs: await listMembershipsForUser(ctx.db, ctx.userId),
        },
        error: null,
        meta: null,
    })),

    // Records which org this user is acting in (packages/db/src/orgContext.ts).
    // The client must invalidate its ENTIRE query cache after this succeeds,
    // not just me.get — every other cached procedure is still holding data
    // scoped to the org the caller just left. See OrgSwitcher.tsx.
    switchOrg: protectedProcedure
        .input(z.object({ orgId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const membership = await setActiveOrg(ctx.db, ctx.userId, input.orgId);
                return { data: membership, error: null, meta: null };
            } catch (err) {
                if (err instanceof NotAMemberError) {
                    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of that organization.' });
                }
                throw err;
            }
        }),

    /**
     * Set your own password. Self-service — the one thing an account on a
     * temporary password (PR-1d) can do, and it clears that state.
     *
     * Verifies the current password, then writes the new hash only if the
     * stored one is still the hash that was verified (guard in the WHERE), so
     * two concurrent changes cannot both win. The credential, the membership
     * flag and the audit row commit together.
     */
    changePassword: protectedProcedure
        .input(z.object({
            currentPassword: z.string().min(1).max(128),
            newPassword: z.string().min(8).max(128),
        }))
        .mutation(async ({ ctx, input }) => {
            if (input.newPassword === input.currentPassword) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'كلمة السر الجديدة لازم تختلف عن الحالية.' });
            }
            const [credential] = await ctx.withOrg((tx) => tx
                .select({ id: account.id, password: account.password })
                .from(account)
                .where(and(eq(account.userId, ctx.userId), eq(account.providerId, 'credential'))));
            if (!credential?.password || !(await verifyPassword({ hash: credential.password, password: input.currentPassword }))) {
                throw new TRPCError({ code: 'UNAUTHORIZED', message: 'كلمة السر الحالية غير صحيحة.' });
            }
            const oldHash = credential.password;
            const newHash = await hashPassword(input.newPassword);

            await ctx.withOrg((tx) => withAudit(
                tx,
                async () => {
                    const changed = await tx.update(account)
                        .set({ password: newHash, updatedAt: new Date() })
                        .where(and(eq(account.id, credential.id), eq(account.password, oldHash)))
                        .returning({ id: account.id });
                    if (changed.length === 0) {
                        throw new TRPCError({ code: 'CONFLICT', message: 'كلمة السر اتغيرت من مكان تاني. جرّب تاني.' });
                    }
                    const [member] = await tx.update(orgMembers)
                        .set({ mustChangePassword: false })
                        .where(and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.userId, ctx.userId)))
                        .returning({ id: orgMembers.id });
                    return member;
                },
                { orgId: ctx.orgId, userId: ctx.userId, action: 'CHANGE_OWN_PASSWORD', tableName: 'account', changes: {} },
            ));
            return { data: { changed: true }, error: null, meta: null };
        }),
});
