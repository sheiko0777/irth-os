import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db, resolveActiveOrgMembership, resolveEffectiveAccess, withOrgContext, withIdempotency, markIdempotencyEffect, IdempotencyError, canAccess, transactionSettings, auditLog, hiddenKeys, redact, type ActionFor, type Resource } from '@irth/db';
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

    // What this member may do (0074): their role's permissions plus per-person
    // grants, minus revokes. Every requirePermission check reads this, not
    // `role`. A suspended member is refused here, before any procedure runs —
    // including the self-service ones that check no permission.
    const access = await resolveEffectiveAccess(db, orgId, userId);
    if (!access) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership.' });
    }
    if (access.suspended) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Account suspended.' });
    }

    let activeIdempotencyClaimId: string | undefined;

    return {
        db,
        session,
        orgId,
        userId,
        role: membership.role,
        access,

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
            withOrgContext(db, orgId, async (tx) => {
                if (activeIdempotencyClaimId) {
                    await markIdempotencyEffect(tx, activeIdempotencyClaimId, orgId);
                }
                return fn(tx);
            }, transactionSettings(access)),

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
            withIdempotency(db, { orgId, operation, key, request }, async (claimId) => {
                const previousClaimId = activeIdempotencyClaimId;
                activeIdempotencyClaimId = claimId;
                try {
                    return await fn();
                } finally {
                    activeIdempotencyClaimId = previousClaimId;
                }
            }),
    };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

// `permission` is set by requirePermission only. permissionGate.test.ts reads
// it to learn which resource.action a procedure claims, then proves by calling
// it that exactly that permission is enforced.
export interface ProcedureMeta {
    permission?: string;
}

// superjson so bigint survives serialization. Money is a count of minor units
// (CLAUDE.md rule 1), and plain JSON cannot represent a bigint — returning one
// from a procedure throws "Do not know how to serialize a BigInt" at runtime,
// not at compile time. Must match the transformer on the client link in
// src/components/providers/TrpcProvider.tsx.
const t = initTRPC.context<Context>().meta<ProcedureMeta>().create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
        if (error.code === 'INTERNAL_SERVER_ERROR' && process.env.NODE_ENV === 'production') {
            return { ...shape, message: 'internal_server_error' };
        }
        return shape;
    },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next, path }) => {
    if (!ctx.session || !ctx.session.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    // Ensure orgId is present
    if (!ctx.orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization scope available.' });
    }

    const result = await next({
        ctx: {
            ...ctx,
            // Enforce non-null types for protected routes
            session: ctx.session,
            orgId: ctx.orgId,
            userId: ctx.userId,
            role: ctx.role,
            access: ctx.access,
        },
    });

    // Sensitive fields (PR-1e): strip what this member may not see from every
    // response, on the server — see packages/db/src/redaction.ts. Every procedure is built on
    // this one, so none can forget it.
    if (!result.ok) return result;
    const hidden = hiddenKeys(ctx.access, path);
    return hidden.size === 0 ? result : { ...result, data: redact(result.data, hidden) };
});

/**
 * A refused call is evidence — someone probing, or a role missing something
 * they need — so it goes to the audit log (PR-1d). At most one row per member,
 * procedure and minute per server instance, so a client retrying in a loop
 * cannot flood the table; and never at the cost of the refusal itself, which
 * stands whether or not the row is written.
 */
const DENIAL_WINDOW_MS = 60_000;
const recentDenials = new Map<string, number>();

async function recordDenied(ctx: Pick<Context, 'orgId' | 'userId' | 'withOrg'>, path: string, permission: string) {
    const key = `${ctx.orgId}:${ctx.userId}:${path}`;
    const now = Date.now();
    const last = recentDenials.get(key);
    if (last !== undefined && now - last < DENIAL_WINDOW_MS) return;
    recentDenials.set(key, now);
    if (recentDenials.size > 10_000) recentDenials.clear();
    try {
        await ctx.withOrg((tx) => tx.insert(auditLog).values({
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'PERMISSION_DENIED',
            tableName: 'permissions',
            recordId: null,
            changes: { path, permission },
        }));
    } catch {
        // The refusal is what matters; a lost audit row must not turn it into a 500.
    }
}

// Requires the caller to hold resource.action — the ONLY authorization gate
// for tenant procedures. Checked against ctx.access, resolved per request from
// the member's role (system or custom) plus per-person grants minus revokes;
// see packages/db/src/permissions.ts. The client-side PermissionGate is UX
// only.
//
// There is deliberately no role-tier procedure (the old adminProcedure /
// ownerProcedure): a tier cannot be granted to or revoked from one person.
// permissionGate.test.ts fails the build if a router procedure is not built
// on this, outside the short allowlist of self-service procedures.
export function requirePermission<R extends Resource>(resource: R, action: ActionFor<R>) {
    return protectedProcedure.meta({ permission: `${resource}.${String(action)}` }).use(async ({ ctx, next, path }) => {
        if (ctx.access.mustChangePassword) {
            // Recognisable by the client, which sends the member to the
            // change-password page instead of showing an error.
            throw new TRPCError({ code: 'FORBIDDEN', message: 'PASSWORD_CHANGE_REQUIRED' });
        }
        if (!canAccess(ctx.access, resource, action)) {
            await recordDenied(ctx, path, `${String(resource)}.${String(action)}`);
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
