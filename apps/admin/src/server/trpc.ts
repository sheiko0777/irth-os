import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db, resolveActiveOrgMembership, withOrgContext, withIdempotency, IdempotencyError, canWithPolicy, type ActionFor, type Resource } from '@irth/db';
import { verifySession } from '@/lib/auth';

export const createContext = async () => {
    // Re-verify session per CVE-2025-29927.
    const session = await verifySession();

    if (!session || !session.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const userId = session.user.id;

    // Better Auth does not put orgId/role on the user — derive the tenant scope
    // and role from the user's org membership.
    //
    // Single shared resolver — see packages/db/src/orgContext.ts for why (this
    // used to be its own copy of the same query as
    // apps/api/src/middlewares/authContext.ts).
    const membership = await resolveActiveOrgMembership(db, userId);

    if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership.' });
    }

    const orgId = membership.orgId;

    return {
        db,
        session,
        orgId,
        userId,
        role: membership.role,
        accessPolicy: membership.accessPolicy,
        permissionOverrides: membership.permissionOverrides,
        assignedWarehouseIds: membership.assignedWarehouseIds,
        jobTitle: membership.jobTitle,

        /**
         * Runs `fn` in a transaction the database will only let touch this
         * tenant's rows: it drops to the unprivileged `irth_app` role and sets
         * `app.org_id`, both transaction-locally, before handing over the
         * handle. RLS policies key on that setting.
         *
         * LAZY ON PURPOSE — the caller wraps just the database section rather
         * than the middleware wrapping the whole handler. An eagerly-opened
         * transaction would pin a pooled server connection for the entire
         * procedure, including the external HTTP calls that courier.ts and
         * eta.ts make inside their handlers; one slow courier response, times a
         * few concurrent admins, exhausts the pool and takes down every tenant.
         * It would also double-book a connection in the nine procedures that
         * already open a transaction of their own.
         *
         * So: no `fetch` inside this callback. Do the network work outside it
         * and pass the result in.
         *
         * This is defence in depth, not a licence to drop `eq(t.orgId, ctx.orgId)`.
         * Keep scoping queries explicitly; RLS is what catches the one that is
         * not scoped.
         */
        withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]): Promise<T> =>
            withOrgContext(db, orgId, fn),

        /**
         * The deliberate cross-tenant escape hatch, for `platformAdminProcedure`
         * only.
         *
         * Platform administration is genuinely cross-org — `listOrgs` reads
         * every organization, `setOrgConfig` writes to whichever `input.orgId`
         * it is given — so running it under this caller's tenant scope would
         * make RLS hide the very rows it exists to manage.
         *
         * It is a separate name from `db` so that "bypasses tenant isolation"
         * is something a reader and a grep can both see. Anything reaching for
         * this outside platformAdmin.ts is a bug: the caller's own tenant data
         * is reachable through `withOrg`, which is scoped.
         *
         * Authorisation for it is a single env-var email check in
         * `platformAdminProcedure` — the database will not second-guess this
         * one, so the procedure guard is the only thing standing in front of
         * every tenant's data.
         */
        dbUnscoped: db,

        /**
         * Runs `fn` at most once per (tenant, operation, key).
         *
         * Atomic is not idempotent. `withOrg` makes a mutation all-or-nothing;
         * two atomic calls still apply twice. A timed-out client, a lost
         * response on mobile data, a double-tapped button and a proxy retry all
         * produce a second identical request for ONE intended action — and the
         * server cannot tell which is which, because a customer genuinely
         * topping up the same card twice in a minute is legitimate. Only a
         * caller-supplied key separates them.
         *
         * `key` is optional: without one this runs `fn` directly and nothing is
         * recorded, so existing callers are unaffected and a client opts in by
         * sending a key.
         *
         * `request` is hashed, so reusing a key with DIFFERENT input is
         * rejected rather than silently replaying the first response and
         * discarding what the second request asked for.
         *
         * Takes the unscoped handle deliberately: the claim must be visible to
         * other sessions BEFORE the work runs, so it commits in its own
         * transaction outside `withOrg`. org_id is written explicitly on every
         * row, and idempotency_keys carries its own RLS policy (0037) for
         * anything that does reach it through a scoped session.
         */
        idempotent: <T>(
            operation: string,
            key: string | undefined,
            request: unknown,
            fn: () => Promise<T>,
        ): Promise<T> =>
            withIdempotency(db, { orgId, operation, key, request }, fn),
    };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

// superjson so bigint survives serialization. Money is a count of minor units
// (CLAUDE.md rule 1), and plain JSON cannot represent a bigint — returning one
// from a procedure throws "Do not know how to serialize a BigInt" at runtime,
// not at compile time. Must match the transformer on the client link in
// src/components/providers/TrpcProvider.tsx.
const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session || !ctx.session.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    // Ensure orgId is present
    if (!ctx.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization scope available.' });
    }

    return next({
        ctx: {
            ...ctx,
            // Enforce non-null types for protected routes
            session: ctx.session,
            orgId: ctx.orgId,
            userId: ctx.userId,
            role: ctx.role,
        },
    });
});

// Requires the caller to be an owner or admin of the active org.
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin role required.' });
    }
    return next({ ctx });
});

// Requires the caller to be the owner of the active org.
export const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.role !== 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner role required.' });
    }
    return next({ ctx });
});
// Requires the caller's role to have the given resource.action permission,
// per the shared matrix in packages/db/src/permissions.ts — the server-side
// mirror of PermissionGate.tsx's client-side check. Additive to
// adminProcedure/ownerProcedure, not a replacement: this is for the routers
// migrated to per-action authorization (see products.ts, orders.ts,
// members.ts), while other routers keep the coarser tier gates.
export function requirePermission<R extends Resource>(resource: R, action: ActionFor<R>) {
    return protectedProcedure.use(({ ctx, next }) => {
        if (!canWithPolicy(ctx.role, resource, action, ctx.accessPolicy, ctx.permissionOverrides)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: `Missing permission: ${String(resource)}.${String(action)}` });
        }
        return next({ ctx });
    });
}

// Requires PLATFORM_ADMIN_EMAIL env var to match the caller's email.
export const platformAdminProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session?.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    if (!adminEmail || ctx.session.user.email !== adminEmail) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required.' });
    }
    return next({ ctx });
});

/**
 * Translates an IdempotencyError into the tRPC code the client should see.
 *
 * CONFLICT   the first attempt is still running, or the key was reclaimed —
 *            the client should retry.
 * BAD_REQUEST the key was reused with different input, or is malformed — the
 *            client must change something before retrying.
 *
 * Without this the error surfaces as INTERNAL_SERVER_ERROR, telling a client
 * that its own retry is a server fault.
 */
export function asTRPCError(err: unknown): never {
    if (err instanceof IdempotencyError) {
        throw new TRPCError({ code: err.code, message: err.message });
    }
    throw err;
}
