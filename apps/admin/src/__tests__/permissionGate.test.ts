/**
 * CLAUDE.md rule 4: authorization is server-side — and, since PR-1b, it is a
 * named resource.action on every procedure, so the owner can grant or revoke
 * it per role and per person (owner decision A5).
 *
 * This gate walks every procedure in the app router. For each one it:
 *   1. requires the permission that requirePermission records on it — a
 *      procedure built on protectedProcedure (or anything else) has none and
 *      fails, unless it is in SELF_SERVICE or PLATFORM below;
 *   2. calls it holding every permission EXCEPT that one → must be FORBIDDEN;
 *   3. calls it holding ONLY that one → must get past authorization.
 * So it is not enough to declare a permission; the procedure has to enforce
 * exactly the one it declares. See helpers/procedureHarness.ts for how a call
 * is made without running the handler.
 */
import { describe, expect, it, vi } from 'vitest';
import { allPermissionKeys, effectiveAccess } from '@irth/db';
import type { ProcedureMeta } from '@/server/trpc';
import { accessWith, harnessCtx, outcomeOf } from './helpers/procedureHarness';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { appRouter } = await import('@/server/routers/_app');

/**
 * Procedures that act only on the caller's own data, so every member — any
 * role, any principal kind — must be able to call them. Suspended members are
 * refused earlier, in createContext.
 */
const SELF_SERVICE = new Set([
  'me.get',          // who am I, which orgs am I in
  'me.switchOrg',    // choose among the caller's own memberships
  'notifications.list',
  'notifications.markRead',
  'notifications.markAllRead',
  'notifications.unreadCount',
]);

/** Cross-tenant platform administration: its own guard (platformAdminProcedure). */
const PLATFORM_PREFIX = 'platformAdmin.';

function procedures(): Array<[string, ProcedureMeta | undefined]> {
  const procs = appRouter._def.procedures as unknown as Record<string, { _def: { meta?: ProcedureMeta } }>;
  return Object.keys(procs).sort().map((p): [string, ProcedureMeta | undefined] => [p, procs[p]?._def.meta]);
}

describe('permission gate', () => {
  it('every tenant procedure declares a permission through requirePermission', () => {
    const offenders = procedures()
      .filter(([p, meta]) => !meta?.permission && !SELF_SERVICE.has(p) && !p.startsWith(PLATFORM_PREFIX))
      .map(([p]) => p);
    expect(
      offenders,
      'Build tenant procedures on requirePermission(resource, action) in server/trpc.ts — not protectedProcedure. '
        + 'Add a new resource.action to packages/db/src/permissions.ts if none fits. Offenders:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('every declared permission is one the matrix knows', () => {
    const known = new Set(allPermissionKeys());
    const unknown = procedures().filter(([, meta]) => meta?.permission && !known.has(meta.permission));
    expect(unknown.map(([p, meta]) => `${p}: ${meta?.permission}`)).toEqual([]);
  });

  it('each procedure enforces exactly the permission it declares', async () => {
    const all = allPermissionKeys();
    const wrong: string[] = [];
    for (const [p, meta] of procedures()) {
      const permission = meta?.permission;
      if (!permission) continue;
      const without = await outcomeOf(appRouter, harnessCtx('member', accessWith(all.filter((k) => k !== permission))), p);
      if (without !== 'deny') wrong.push(`${p}: allowed without ${permission}`);
      const only = await outcomeOf(appRouter, harnessCtx('member', accessWith([permission])), p);
      if (only !== 'allow') wrong.push(`${p}: denied while holding ${permission}`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('self-service procedures are open to a member holding no permission at all', async () => {
    const denied: string[] = [];
    for (const p of SELF_SERVICE) {
      if (await outcomeOf(appRouter, harnessCtx('member', accessWith([])), p) !== 'allow') denied.push(p);
    }
    expect(denied).toEqual([]);
    // And the allowlist names only procedures that exist.
    const paths = new Set(procedures().map(([p]) => p));
    expect([...SELF_SERVICE].filter((p) => !paths.has(p))).toEqual([]);
  });

  it('a suspended owner is refused by every permission-checked procedure', async () => {
    const suspended = effectiveAccess({ systemKey: 'owner', status: 'suspended' });
    const allowed: string[] = [];
    for (const [p, meta] of procedures()) {
      if (!meta?.permission) continue;
      if (await outcomeOf(appRouter, harnessCtx('owner', suspended), p) !== 'deny') allowed.push(p);
    }
    expect(allowed).toEqual([]);
  });
});
