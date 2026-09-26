// Deep import deliberately, NOT from '@irth/db': this file is bundled into
// the browser (widely imported by 'use client' components). The package root
// (packages/db/src/index.ts) runs `createDb(process.env.DATABASE_URL!)` at
// module scope — a real Postgres connection — which a client bundle must
// never evaluate. permissions.ts itself has no imports and no side effects,
// so reaching past the barrel straight to it is safe; going through '@irth/db'
// is not.
export { can, PERMISSIONS } from '@irth/db/src/permissions';
import type { ActionFor, Resource } from '@irth/db/src/permissions';
export type { ActionFor, Resource };
import type { Role } from '@irth/db/src/permissions';
import { trpc } from './trpc';

/**
 * The caller's role in the active organisation.
 *
 * This used to read `session.user.role` / `session.session.activeOrganizationRole`
 * from Better Auth. Better Auth never populates either — this app stores roles
 * in `org_members`, and only the server resolved them. The hook therefore
 * returned null for every user, PermissionGate rendered null, and every gated
 * control was invisible to everyone including owners: the whole categories
 * table, product create and edit, member invites, and role changes.
 *
 * It now reads `me.get`, which returns the role createContext already derives
 * per request.
 *
 * This gates UI affordances only. The server procedures (requirePermission
 * in server/trpc.ts) remain the authorization boundary — a client that lies about
 * its role still gets rejected there.
 */
function useMe() {
  // Permissions change rarely and every gated component calls this, so cache
  // for a few minutes rather than refetching on every mount.
  return trpc.me.get.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Whether the caller holds resource.action in the active org — their
 * effective permissions (role plus per-person grants, minus revokes), exactly
 * what the server checks. False while loading. UX only, like everything here.
 */
export function useCan(): <R extends Resource>(resource: R, action: ActionFor<R>) => boolean {
  const { data } = useMe();
  const perms = new Set(data?.data.permissions ?? []);
  return (resource, action) => perms.has(`${resource}.${String(action)}`);
}

export function useRole(): Role | null {
  const { data } = useMe();
  return (data?.data.role as Role | undefined) ?? null;
}