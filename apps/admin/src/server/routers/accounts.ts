import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  accessRoles, account, brands, canDelegate, covers, effectiveAccess, memberScopes, orgMembers, permissionKeys, permissionsForRole,
  priceLists, suppliers, withinScopes, type MemberScopes,
  session, user, withAudit, type DbTx, type EffectiveAccess, type PermissionList,
} from '@irth/db';
import { router, requirePermission, type Context } from '../trpc';
import { permissionListSchema, pgCode } from '../permissionInput';
import { inheritedScopes, insertAccount, rethrowAccountError, temporaryPassword, usernameSchema } from '../accountCreation';

/**
 * Accounts the owner manages directly (PR-1d, owner decision A5): create a
 * staff member, rep or supplier with a username (usually a mobile number) and
 * a temporary password; give them a role; grant or revoke single permissions
 * for that one person; suspend or reactivate them; reset their password; and
 * see what they can actually do.
 *
 * Three rules hold on every write, all server-side:
 *   - Delegation: nobody gives a role or a grant holding a permission they do
 *     not hold themselves, and only the owner gives the owner role
 *     (canDelegate). Nobody changes a member whose authority exceeds their
 *     own (covers), and nobody changes themselves here.
 *   - Atomicity: the user, their credential, their membership and the audit
 *     row are one transaction (ctx.withOrg). A failure anywhere leaves no
 *     half-created account.
 *   - The org keeps an active owner: 0075's deferred trigger refuses any
 *     commit that would leave members and no active owner.
 */

const memberIdSchema = z.object({ memberId: z.string().uuid() });

type Tx = DbTx;

async function loadRole(tx: Tx, orgId: string, roleId: string) {
  const [role] = await tx.select().from(accessRoles).where(and(eq(accessRoles.id, roleId), eq(accessRoles.orgId, orgId)));
  if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود.' });
  const list: PermissionList = role.systemKey ? permissionsForRole(role.systemKey) : role.permissions;
  return { ...role, list };
}

/** A member's row and current effective access, in this org only. */
async function loadMember(tx: Tx, orgId: string, memberId: string) {
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
function assertMayManage(ctx: Pick<Context, 'userId' | 'access'>, target: { member: { userId: string }; authority: EffectiveAccess }) {
  if (target.member.userId === ctx.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'لا يمكنك تعديل حسابك من هنا.' });
  }
  if (!covers(ctx.access, target.authority)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'صلاحيات هذا العضو أعلى من صلاحياتك.' });
  }
}

function assertMayDelegate(ctx: Pick<Context, 'access'>, perms: Iterable<string>, ownerRole = false) {
  if (!canDelegate(ctx.access, perms, { ownerRole })) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'لا يمكنك منح صلاحيات لا تملكها.' });
  }
}



export const accountsRouter = router({
  /** Create an account directly. The temporary password is returned once and never stored in plain text. */
  create: requirePermission('members', 'create')
    .input(z.object({
      name: z.string().trim().min(1).max(80),
      username: usernameSchema,
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      accessRoleId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const password = temporaryPassword();
      const hash = await hashPassword(password); // scrypt, outside the transaction
      const userId = crypto.randomUUID();
      try {
        const member = await ctx.withOrg(async (tx) => {
          const role = await loadRole(tx, ctx.orgId, input.accessRoleId);
          assertMayDelegate(ctx, permissionKeys(role.list), role.systemKey === 'owner');

          return withAudit(
            tx,
            async () => {
              // A member limited to some brands, suppliers or price lists
              // cannot create someone who sees more: the new account
              // inherits the creator's scopes (PR-1e).
              const row = await insertAccount(tx, ctx, {
                userId, name: input.name, username: input.username, email: input.email ?? null, passwordHash: hash,
                role, scopes: inheritedScopes(ctx),
              });
              return row;
            },
            {
              orgId: ctx.orgId, userId: ctx.userId, action: 'CREATE_ACCOUNT', tableName: 'org_members',
              changes: { name: input.name, username: input.username, email: input.email ?? null, role: role.name },
            },
          );
        });
        return { data: { memberId: member.id, username: input.username, temporaryPassword: password }, error: null, meta: null };
      } catch (err) {
        rethrowAccountError(err);
      }
    }),

  assignRole: requirePermission('members', 'changeRole')
    .input(memberIdSchema.extend({ accessRoleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.withOrg(async (tx) => {
          const target = await loadMember(tx, ctx.orgId, input.memberId);
          assertMayManage(ctx, target);
          const role = await loadRole(tx, ctx.orgId, input.accessRoleId);
          assertMayDelegate(ctx, permissionKeys(role.list), role.systemKey === 'owner');

          return withAudit(
            tx,
            async () => {
              const [updated] = await tx.update(orgMembers)
                .set({ accessRoleId: role.id, role: role.systemKey ?? 'member', principalKind: role.principalKind })
                .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
                .returning();
              return updated;
            },
            {
              orgId: ctx.orgId, userId: ctx.userId, action: 'ASSIGN_ROLE', tableName: 'org_members',
              changes: { memberId: input.memberId, from: target.roleName, to: role.name },
            },
          );
        });
        return { data: row, error: null, meta: null };
      } catch (err) {
        rethrowAccountError(err);
      }
    }),

  /** Per-person exceptions: permissions added to, or taken from, what the role gives. */
  setOverrides: requirePermission('members', 'changeRole')
    .input(memberIdSchema.extend({ grant: permissionListSchema, revoke: permissionListSchema }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.withOrg(async (tx) => {
        const target = await loadMember(tx, ctx.orgId, input.memberId);
        assertMayManage(ctx, target);
        assertMayDelegate(ctx, permissionKeys(input.grant));

        return withAudit(
          tx,
          async () => {
            const [updated] = await tx.update(orgMembers)
              .set({ overrides: { grant: input.grant, revoke: input.revoke } })
              .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
              .returning();
            return updated;
          },
          {
            orgId: ctx.orgId, userId: ctx.userId, action: 'SET_MEMBER_OVERRIDES', tableName: 'org_members',
            changes: { memberId: input.memberId, from: target.member.overrides, to: { grant: input.grant, revoke: input.revoke } },
          },
        );
      });
      return { data: row, error: null, meta: null };
    }),

  setStatus: requirePermission('members', 'suspend')
    .input(memberIdSchema.extend({ status: z.enum(['active', 'suspended']) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.withOrg(async (tx) => {
          const target = await loadMember(tx, ctx.orgId, input.memberId);
          assertMayManage(ctx, target);
          return withAudit(
            tx,
            async () => {
              const [updated] = await tx.update(orgMembers)
                .set({ status: input.status })
                .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
                .returning();
              return updated;
            },
            {
              orgId: ctx.orgId, userId: ctx.userId, action: input.status === 'suspended' ? 'SUSPEND_MEMBER' : 'REACTIVATE_MEMBER',
              tableName: 'org_members', changes: { memberId: input.memberId, from: target.member.status, to: input.status },
            },
          );
        });
        return { data: row, error: null, meta: null };
      } catch (err) {
        rethrowAccountError(err);
      }
    }),

  /**
   * A new temporary password, returned once; every session of that user ends
   * and they must set their own on next sign-in. Only for accounts that belong
   * to this org alone — a password is the person's, not the org's, and an
   * admin here must not be able to take over someone's access to another org.
   */
  resetPassword: requirePermission('members', 'resetPassword')
    .input(memberIdSchema)
    .mutation(async ({ ctx, input }) => {
      const password = temporaryPassword();
      const hash = await hashPassword(password);
      await ctx.withOrg(async (tx) => {
        const target = await loadMember(tx, ctx.orgId, input.memberId);
        assertMayManage(ctx, target);
        const targetUserId = target.member.userId;
        // Across every org, which RLS rightly hides from this connection —
        // hence a SECURITY DEFINER function that returns the count and
        // nothing else (0075).
        const [{ n }] = await tx.execute<{ n: number }>(sql`SELECT user_membership_count(${targetUserId}) AS n`);
        if (n > 1) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'الحساب ده عضو في مؤسسة تانية، ومينفعش تغيّر كلمة سره من هنا.' });
        }

        return withAudit(
          tx,
          async () => {
            const updated = await tx.update(account).set({ password: hash, updatedAt: new Date() })
              .where(and(eq(account.userId, targetUserId), eq(account.providerId, 'credential')))
              .returning({ id: account.id });
            if (updated.length === 0) {
              throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'الحساب ده بيدخل بطريقة تانية، مفيش كلمة سر تتغير.' });
            }
            await tx.delete(session).where(eq(session.userId, targetUserId));
            const [row] = await tx.update(orgMembers).set({ mustChangePassword: true })
              .where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId)))
              .returning({ id: orgMembers.id });
            return row;
          },
          { orgId: ctx.orgId, userId: ctx.userId, action: 'RESET_MEMBER_PASSWORD', tableName: 'org_members', changes: { memberId: input.memberId } },
        );
      });
      return { data: { temporaryPassword: password }, error: null, meta: null };
    }),

  /** The brands, suppliers and price lists a scope can name — as far as the caller can see them. */
  scopeOptions: requirePermission('members', 'changeRole').query(async ({ ctx }) => {
    const [brandRows, supplierRows, pricelistRows] = await ctx.withOrg((tx) => Promise.all([
      tx.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.orgId, ctx.orgId)).orderBy(asc(brands.name)),
      tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.orgId, ctx.orgId)).orderBy(asc(suppliers.name)),
      tx.select({ id: priceLists.id, name: priceLists.name }).from(priceLists).where(eq(priceLists.orgId, ctx.orgId)).orderBy(asc(priceLists.name)),
    ]));
    return { data: { brands: brandRows, suppliers: supplierRows, pricelists: pricelistRows }, error: null, meta: null };
  }),

  /**
   * Limit a member to some brands and/or suppliers (PR-1e); an empty list
   * lifts that limit. Enforced by 0076's policies and the routers' explicit
   * filters. Nobody sets a scope wider than their own.
   */
  setScopes: requirePermission('members', 'changeRole')
    .input(memberIdSchema.extend({
      brand: z.array(z.string().uuid()).max(100),
      supplier: z.array(z.string().uuid()).max(100),
      // PR-2b. Optional so a caller that predates it keeps its meaning.
      pricelist: z.array(z.string().uuid()).max(100).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const next: MemberScopes = {
        brand: [...new Set(input.brand)].sort(),
        supplier: [...new Set(input.supplier)].sort(),
        pricelist: [...new Set(input.pricelist)].sort(),
      };
      if (!withinScopes(ctx.access.scopes, next)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'لا يمكنك منح نطاق أوسع من نطاقك.' });
      }
      const row = await ctx.withOrg(async (tx) => {
        const target = await loadMember(tx, ctx.orgId, input.memberId);
        assertMayManage(ctx, target);
        // Every id must be a brand or supplier of this org (and visible to the caller).
        const [foundBrands, foundSuppliers, foundPricelists] = await Promise.all([
          next.brand.length ? tx.select({ id: brands.id }).from(brands).where(and(eq(brands.orgId, ctx.orgId), inArray(brands.id, next.brand))) : [],
          next.supplier.length ? tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.orgId, ctx.orgId), inArray(suppliers.id, next.supplier))) : [],
          next.pricelist.length ? tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.orgId, ctx.orgId), inArray(priceLists.id, next.pricelist))) : [],
        ]);
        if (foundBrands.length !== next.brand.length || foundSuppliers.length !== next.supplier.length || foundPricelists.length !== next.pricelist.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'براند أو مورد أو قائمة أسعار غير موجودة.' });
        }

        return withAudit(
          tx,
          async () => {
            await tx.delete(memberScopes).where(and(
              eq(memberScopes.orgId, ctx.orgId),
              eq(memberScopes.memberId, input.memberId),
              inArray(memberScopes.scopeKind, ['brand', 'supplier', 'pricelist']),
            ));
            const values = [
              ...next.brand.map((id) => ({ scopeKind: 'brand' as const, scopeId: id })),
              ...next.supplier.map((id) => ({ scopeKind: 'supplier' as const, scopeId: id })),
              ...next.pricelist.map((id) => ({ scopeKind: 'pricelist' as const, scopeId: id })),
            ].map((v) => ({ ...v, orgId: ctx.orgId, memberId: input.memberId }));
            if (values.length > 0) await tx.insert(memberScopes).values(values);
            return { id: input.memberId };
          },
          {
            orgId: ctx.orgId, userId: ctx.userId, action: 'SET_MEMBER_SCOPES', tableName: 'member_scopes',
            changes: { memberId: input.memberId, from: target.authority.scopes, to: next },
          },
        );
      });
      return { data: row, error: null, meta: null };
    }),

  /** What this member can actually do: their role, their exceptions, and the result. */
  effective: requirePermission('members', 'view')
    .input(memberIdSchema)
    .query(async ({ ctx, input }) => {
      const target = await ctx.withOrg((tx) => loadMember(tx, ctx.orgId, input.memberId));
      return {
        data: {
          roleName: target.roleName,
          status: target.member.status,
          overrides: target.member.overrides,
          scopes: target.authority.scopes,
          permissions: [...target.access.perms].sort(),
        },
        error: null,
        meta: null,
      };
    }),
});
