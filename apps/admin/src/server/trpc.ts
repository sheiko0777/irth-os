import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db, orgMembers } from '@irth/db';
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
    // and role from the user's org membership. Prefer the active organization
    // from the session, falling back to the user's first membership.
    const activeOrgId = session.session?.activeOrganizationId;

    let membership;
    if (activeOrgId) {
        [membership] = await db
            .select()
            .from(orgMembers)
            .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, activeOrgId)))
            .limit(1);
    }
    if (!membership) {
        [membership] = await db
            .select()
            .from(orgMembers)
            .where(eq(orgMembers.userId, userId))
            .limit(1);
    }

    if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership.' });
    }

    return {
        db,
        session,
        orgId: membership.orgId,
        userId,
        role: membership.role as Role,
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
