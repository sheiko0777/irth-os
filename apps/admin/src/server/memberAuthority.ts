import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import {
  accessRoles, canDelegate, covers, effectiveAccess, memberScopes, orgMembers,
  type DbTx, type EffectiveAccess, type MemberScopes,
} from '@irth/db';
import type { Context } from './trpc';

/**
 * The delegation rules every write that changes another member passes, in one
 * place (moved out of routers/accounts.ts so members.ts and roles.ts cannot
 * drift from it):
 *   - nobody changes a member whose authority exceeds their own (covers), and
 *     nobody changes themselves through these paths;
 *   - nobody gives a role or permission they do not hold themselves, and only
 *     the owner gives the owner role (canDelegate).
 */

type Tx = DbTx;

/** A member's row and current effective access, in this org only. */
export async function loadMember(tx: Tx, orgId: string, memberId: string) {
  const [row] = await tx
    .select({ member: orgMembers, systemKey: accessRoles.systemKey, rolePermissions: accessRoles.permissions, roleName: accessRoles.name })
    .from(orgMembers)
    .leftJoin(accessRoles, and(eq(accessRoles.id, orgMembers.accessRoleId), eq(accessRoles.orgId, orgMembers.orgId)))
    .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)));
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'العضو غير موجود.' });
  const scopeRows = await tx
    .select({ kind: memberScopes.scopeKind, id: memberScopes.scopeId })
    .from(memberScopes)
    .where(and(eq(memberScopes.orgId, orgId), eq(memberScopes.memberId, memberId)));
  const scopes: MemberScopes = {
    brand: scopeRows.filter((r) => r.kind === 'brand').map((r) => r.id).sort(),
    supplier: scopeRows.filter((r) => r.kind === 'supplier').map((r) => r.id).sort(),
    pricelist: scopeRows.filter((r) => r.kind === 'pricelist').map((r) => r.id).sort(),
  };
  const base = {
    systemKey: row.systemKey ?? null,
    rolePermissions: row.rolePermissions ?? undefined,
    overrides: row.member.overrides,
    principalKind: row.member.principalKind,
    scopes,
  };
  return {
    ...row,
    // What they can do right now (nothing while suspended)…
    access: effectiveAccess({ ...base, status: row.member.status }),
    // …and the authority they hold regardless of status: a suspended owner is
    // still the owner, and an admin must not be able to manage them.
    authority: effectiveAccess(base),
  };
}

/** The checks every change to another member passes first. */
export function assertMayManage(ctx: Pick<Context, 'userId' | 'access'>, target: { member: { userId: string }; authority: EffectiveAccess }) {
  if (target.member.userId === ctx.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'لا يمكنك تعديل حسابك من هنا.' });
  }
  if (!covers(ctx.access, target.authority)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'صلاحيات هذا العضو أعلى من صلاحياتك.' });
  }
}

export function assertMayDelegate(ctx: Pick<Context, 'access'>, perms: Iterable<string>, ownerRole = false) {
  if (!canDelegate(ctx.access, perms, { ownerRole })) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'لا يمكنك منح صلاحيات لا تملكها.' });
  }
}
