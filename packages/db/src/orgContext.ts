import { and, asc, eq } from 'drizzle-orm';
import { organizations, orgMembers } from './schema';
import { user } from './schema/auth';
import { accessProfiles } from './schema/access';
import type { Role } from './permissions';
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
  accessPolicy: unknown;
  permissionOverrides: unknown;
  assignedWarehouseIds: string[];
  jobTitle: string | null;
}

type MembershipRow = {
  orgId: string;
  role: string;
  accessProfileId: string | null;
  permissionOverrides: unknown;
  assignedWarehouseIds: string[];
  jobTitle: string | null;
};

async function withPolicy(db: Pick<DbInstance, 'select'>, membership: MembershipRow): Promise<ActiveOrgMembership> {
  const [profile] = membership.accessProfileId
    ? await db.select({ permissions: accessProfiles.permissions }).from(accessProfiles)
      .where(and(eq(accessProfiles.id, membership.accessProfileId), eq(accessProfiles.orgId, membership.orgId))).limit(1)
    : [];
  return {
    orgId: membership.orgId,
    role: membership.role as Role,
    accessPolicy: profile?.permissions ?? null,
    permissionOverrides: membership.permissionOverrides,
    assignedWarehouseIds: membership.assignedWarehouseIds ?? [],
    jobTitle: membership.jobTitle,
  };
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
 * Returns `null` only when the user has zero memberships anywhere — the
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
      .select({ orgId: orgMembers.orgId, role: orgMembers.role, accessProfileId: orgMembers.accessProfileId, permissionOverrides: orgMembers.permissionOverrides, assignedWarehouseIds: orgMembers.assignedWarehouseIds, jobTitle: orgMembers.jobTitle })
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, pinned.lastActiveOrgId)))
      .limit(1);

    if (membership) return withPolicy(db, membership);
    // Pin points at a membership that no longer exists (revoked) — fall
    // through to the deterministic default below rather than dead-ending.
  }

  const [oldest] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, accessProfileId: orgMembers.accessProfileId, permissionOverrides: orgMembers.permissionOverrides, assignedWarehouseIds: orgMembers.assignedWarehouseIds, jobTitle: orgMembers.jobTitle })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(orgMembers.createdAt))
    .limit(1);

  return oldest ? withPolicy(db, oldest) : null;
}

/**
 * Records a user's choice of active org, after verifying they are actually a
 * member — a client cannot switch into an org it does not belong to.
 */
export async function setActiveOrg(
  db: DbInstance,
  userId: string,
  orgId: string,
): Promise<ActiveOrgMembership> {
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, accessProfileId: orgMembers.accessProfileId, permissionOverrides: orgMembers.permissionOverrides, assignedWarehouseIds: orgMembers.assignedWarehouseIds, jobTitle: orgMembers.jobTitle })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);

  if (!membership) throw new NotAMemberError(orgId);

  await db.update(user).set({ lastActiveOrgId: orgId }).where(eq(user.id, userId));

  return withPolicy(db, membership);
}

/** Every org a user belongs to, for a switcher UI. */
export async function listMembershipsForUser(
  db: Pick<DbInstance, 'select'>,
  userId: string,
): Promise<OrgMembershipSummary[]> {
  const rows = await db
    .select({ orgId: orgMembers.orgId, orgName: organizations.name, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(orgMembers.createdAt));

  return rows.map((r) => ({ orgId: r.orgId, orgName: r.orgName, role: r.role as Role }));
}
