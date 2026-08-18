import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db, orgMembers, withOrgContext } from '@irth/db';
import { and, eq } from 'drizzle-orm';
import type { Role } from '@irth/db/src/permissions';
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
    // The `session.activeOrganizationId` branch that used to sit here could
    // never execute: that column comes from Better Auth's organization plugin,
    // which is deliberately off (see lib/auth-server.ts), so it does not exist
    // and the value was always undefined. Only the fallback ever ran.
    //
    // Stated plainly instead of implied by dead code: a user in more than one
    // organization always gets whichever membership Postgres returns first and
    // cannot switch. Org switching needs the choice stored somewhere real, not
    // read from a field nothing writes. Mirrored in
    // apps/api/src/middlewares/authContext.ts.
    const [membership] = await db
        .select()
        .from(orgMembers)
        .where(eq(orgMembers.userId, userId))
        .limit(1);

    if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership.' });
    }

    const orgId = membership.orgId;

    return {
        db,
        session,
        orgId,
        userId,
        role: membership.role as Role,

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
