import { TRPCError } from '@trpc/server';
import type { EffectiveAccess, Role } from '@irth/db';
import type { Context } from '@/server/trpc';
import type { appRouter as AppRouterValue } from '@/server/routers/_app';

/**
 * Calls a real app-router procedure and reports only whether authorization let
 * it through — without running anything behind the check.
 *
 * Every handle a handler could reach (db, dbUnscoped, withOrg, idempotent)
 * throws on first touch, and input is `undefined`. An allowed call therefore
 * ends in that throw, an input error, or whatever the handler throws first;
 * a denied call ends in FORBIDDEN from the middleware before any of that.
 */
class Untouchable extends Error {}
const untouchable: unknown = new Proxy(() => undefined, {
  get() { throw new Untouchable('context handle touched'); },
  apply() { throw new Untouchable('context handle called'); },
});

export function harnessCtx(role: Role, access: EffectiveAccess): Context {
  return {
    db: untouchable,
    dbUnscoped: untouchable,
    withOrg: untouchable,
    idempotent: untouchable,
    session: { user: { id: 'harness-user', email: 'harness@test.com' } },
    orgId: '00000000-0000-4000-8000-000000000001',
    userId: 'harness-user',
    role,
    access,
  } as unknown as Context;
}

export type Outcome = 'allow' | 'deny';

export async function outcomeOf(router: typeof AppRouterValue, ctx: Context, procPath: string): Promise<Outcome> {
  let target: unknown = router.createCaller(ctx);
  for (const part of procPath.split('.')) target = (target as Record<string, unknown>)[part];
  try {
    await (target as (input: unknown) => Promise<unknown>)(undefined);
    return 'allow';
  } catch (err) {
    return err instanceof TRPCError && err.code === 'FORBIDDEN' ? 'deny' : 'allow';
  }
}

/** Access holding exactly these "resource.action" keys — a custom role, not suspended. */
export function accessWith(perms: Iterable<string>): EffectiveAccess {
  return { isOwner: false, principalKind: 'staff', suspended: false, mustChangePassword: false, scopes: { brand: [], supplier: [] }, memberId: null, perms: new Set(perms) };
}
