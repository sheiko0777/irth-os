import { router, protectedProcedure } from '../trpc';

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
    get: protectedProcedure.query(({ ctx }) => ({
        data: {
            userId: ctx.userId,
            orgId: ctx.orgId,
            role: ctx.role,
        },
        error: null,
        meta: null,
    })),
});
