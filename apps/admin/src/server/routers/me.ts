import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { listMembershipsForUser, setActiveOrg, NotAMemberError } from '@irth/db';

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
 * procedures (adminProcedure, ownerProcedure) remain the enforcement point.
 * This only tells the UI which affordances are worth drawing.
 */
export const meRouter = router({
    get: protectedProcedure.query(async ({ ctx }) => ({
        data: {
            userId: ctx.userId,
            orgId: ctx.orgId,
            role: ctx.role,
            accessPolicy: ctx.accessPolicy,
            permissionOverrides: ctx.permissionOverrides,
            assignedWarehouseIds: ctx.assignedWarehouseIds,
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
});
