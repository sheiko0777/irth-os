import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db, orgMembers, organizations, withOrgContext, withIdempotency, IdempotencyError } from '@irth/db';
import { and, eq } from 'drizzle-orm';
import type { Role } from '@irth/db';
import { verifySession } from '@/lib/auth';

export const createContext = async () => {
    const session = await verifySession();
    if (!session?.user) throw new TRPCError({ code: 'UNAUTHORIZED' });

    const userId = session.user.id;
    const requestedOrgId = session.session.activeOrganizationId;
    let membership;

    if (requestedOrgId) {
        [membership] = await db.select({
            id: orgMembers.id,
            orgId: orgMembers.orgId,
            role: orgMembers.role,
        }).from(orgMembers)
            .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, requestedOrgId)))
            .limit(1);
    }

    if (!membership) {
        [membership] = await db.select({
            id: orgMembers.id,
            orgId: orgMembers.orgId,
            role: orgMembers.role,
        }).from(orgMembers)
            .where(eq(orgMembers.userId, userId))
            .limit(1);
    }

    if (!membership) throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership.' });

    const orgId = membership.orgId;
    return {
        db,
        session,
        orgId,
        userId,
        role: membership.role as Role,
        withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]): Promise<T> => withOrgContext(db, orgId, fn),
        dbUnscoped: db,
        idempotent: <T>(operation: string, key: string | undefined, request: unknown, fn: () => Promise<T>): Promise<T> =>
            withIdempotency(db, { orgId, operation, key, request }, fn),
    };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
const t = initTRPC.context<Context>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session?.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    if (!ctx.orgId) throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization scope available.' });
    return next({ ctx });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.role !== 'owner' && ctx.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin role required.' });
    return next({ ctx });
});

export const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner role required.' });
    return next({ ctx });
});

export const platformAdminProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session?.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    if (!adminEmail || ctx.session.user.email !== adminEmail) throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required.' });
    return next({ ctx });
});

export function asTRPCError(err: unknown): never {
    if (err instanceof IdempotencyError) throw new TRPCError({ code: err.code, message: err.message });
    throw err;
}
