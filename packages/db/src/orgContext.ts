import { and, asc, eq } from 'drizzle-orm';
import { organizations, orgMembers } from './schema';
import { accessRoles, memberScopes } from './schema/access';
import { user } from './schema/auth';
import { effectiveAccess, type EffectiveAccess, type MemberScopes, type Role } from './permissions';
import type { DbInstance } from './index';

/**
 * The single place both apps resolve "which org is this request acting in."
 *
 * Before this file, `apps/api/src/middlewares/authContext.ts` and
 * `apps/admin/src/server/trpc.ts::createContext` each ran the same unordered
 * `org_members` query independently — two copies of the same logic, and the
 * exact kind of drift this app's own conventions warn against elsewhere (see
 * the ETA service files' "should be ONE shared module" banner). A user in 2+
 * orgs landed on whatever row Postgres happened to return first, with no way
 * to switch. This module is the fix: both call sites now import the same
 * function.
 */

export interface ActiveOrgMembership {
  orgId: string;
  role: Role;
}

export interface OrgMembershipSummary {
  orgId: string;
  orgName: string;
  role: Role;
}

/** Thrown by `setActiveOrg` when the caller is not a member of the target org. */
export class NotAMemberError extends Error {
  constructor(readonly orgId: string) {
    super(`Not a member of organization ${orgId}`);
    this.name = 'NotAMemberError';
  }
}

/**
 * Resolves which org a user is currently acting in.
 *
 * Order: `user.last_active_org_id` if set AND the membership it points at
 * still exists (a revoked membership falls through, not a dead end) —
 * otherwise the OLDEST membership by `created_at`. "Oldest" replaces
 * Postgres's previously-unspecified row order with a deterministic default: a
 * user's very first org is the one they land in until they explicitly
 * choose otherwise.
 *
 * Suspended memberships (0074) are skipped entirely: a member suspended in
 * one org lands in another org they are active in, rather than being locked
 * out of all of them by the org they happened to be pinned to.
 *
 * Returns `null` only when the user has zero active memberships anywhere — the
 * onboarding case. Callers decide whether that is fatal (createContext
 * throws FORBIDDEN) or not (authContext.ts leaves orgId/role unset; routes
 * that need one guard via requireRole).
 */
export async function resolveActiveOrgMembership(
  db: Pick<DbInstance, 'select'>,
  userId: string,
): Promise<ActiveOrgMembership | null> {
  const [pinned] = await db
    .select({ lastActiveOrgId: user.lastActiveOrgId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (pinned?.lastActiveOrgId) {
    const [membership] = await db
      .select({ orgId: orgMembers.orgId, role: orgMembers.role })
      .from(orgMembers)
      .where(and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.orgId, pinned.lastActiveOrgId),
        eq(orgMembers.status, 'active'),
      ))
      .limit(1);

    if (membership) return { orgId: membership.orgId, role: membership.role as Role };
    // Pin points at a membership that no longer exists (revoked) — fall
    // through to the deterministic default below rather than dead-ending.
  }

  const [oldest] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')))
    .orderBy(asc(orgMembers.createdAt))
    .limit(1);

  return oldest ? { orgId: oldest.orgId, role: oldest.role as Role } : null;
}

/**
 * Records a user's choice of active org, after verifying they are actually an
 * active member — a client cannot switch into an org it does not belong to, or
 * one that has suspended it.
 */
export async function setActiveOrg(
  db: DbInstance,
  userId: string,
  orgId: string,
): Promise<ActiveOrgMembership> {
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId), eq(orgMembers.status, 'active')))
    .limit(1);

  if (!membership) throw new NotAMemberError(orgId);

  await db.update(user).set({ lastActiveOrgId: orgId }).where(eq(user.id, userId));

  return { orgId: membership.orgId, role: membership.role as Role };
}

/** Every org a user is an active member of, for a switcher UI. */
export async function listMembershipsForUser(
  db: Pick<DbInstance, 'select'>,
  userId: string,
): Promise<OrgMembershipSummary[]> {
  const rows = await db
    .select({ orgId: orgMembers.orgId, orgName: organizations.name, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')))
    .orderBy(asc(orgMembers.createdAt));

  return rows.map((r) => ({ orgId: r.orgId, orgName: r.orgName, role: r.role as Role }));
}

/**
 * A member's effective permissions in one org (0074): their role's list —
 * the code matrix for a system role — plus per-person grants, minus revokes;
 * nothing at all if suspended. Null when the user is not a member.
 *
 * The authority every request is checked against — see the note on
 * effectiveAccess in permissions.ts.
 */
export async function resolveEffectiveAccess(
  db: Pick<DbInstance, 'select'>,
  orgId: string,
  userId: string,
): Promise<EffectiveAccess | null> {
  const [row] = await db
    .select({
      memberId: orgMembers.id,
      role: orgMembers.role,
      principalKind: orgMembers.principalKind,
      status: orgMembers.status,
      overrides: orgMembers.overrides,
      mustChangePassword: orgMembers.mustChangePassword,
      systemKey: accessRoles.systemKey,
      rolePermissions: accessRoles.permissions,
    })
    .from(orgMembers)
    .leftJoin(accessRoles, and(eq(accessRoles.id, orgMembers.accessRoleId), eq(accessRoles.orgId, orgMembers.orgId)))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);

  if (!row) return null;
  const scopeRows = await db
    .select({ kind: memberScopes.scopeKind, id: memberScopes.scopeId })
    .from(memberScopes)
    .where(and(eq(memberScopes.orgId, orgId), eq(memberScopes.memberId, row.memberId)));
  const scopes: MemberScopes = {
    brand: scopeRows.filter((r) => r.kind === 'brand').map((r) => r.id).sort(),
    supplier: scopeRows.filter((r) => r.kind === 'supplier').map((r) => r.id).sort(),
    pricelist: scopeRows.filter((r) => r.kind === 'pricelist').map((r) => r.id).sort(),
  };
  // A member not (yet) linked to a role row falls back to their text role —
  // the same authority requirePermission uses today — never to "nothing"
  // and never to "everything".
  const legacy = ['owner', 'admin', 'member'].includes(row.role) ? (row.role as Role) : null;
  return effectiveAccess({
    systemKey: row.systemKey ?? (row.rolePermissions ? null : legacy),
    rolePermissions: row.rolePermissions ?? undefined,
    overrides: row.overrides,
    principalKind: row.principalKind,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    scopes,
    memberId: row.memberId,
  });
}
