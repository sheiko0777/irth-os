import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import {
  accessRoles, orgMembers, permissionsForRole, withAudit, PERMISSIONS, PRINCIPAL_KINDS, type PermissionList, type Resource,
} from '@irth/db';
import { router, requirePermission } from '../trpc';

/**
 * The roles screen (PR-1c, owner decision A5): the org's roles and what each
 * may do. System roles (مالك / مدير / موظف) are shown with their permissions
 * — the code matrix — and cannot be edited. Custom roles are created, edited
 * and deleted here; "copy" on the screen is a create pre-filled from another
 * role's list, system roles included.
 *
 * Assigning a role to a member is the members screen's job (PR-1d).
 *
 * Every write runs in ctx.withOrg with its audit row in the same transaction,
 * and every guard sits in the WHERE clause: a system role cannot be edited or
 * deleted, and a role with members cannot be deleted, even by two concurrent
 * requests.
 */

const nameSchema = z.string().trim().min(1).max(60);
const principalKindSchema = z.enum(PRINCIPAL_KINDS);

/** {resource: [action]} limited to what the matrix declares; unknown pairs are rejected, not dropped. */
const permissionListSchema = z
  .record(z.string().max(40), z.array(z.string().max(40)).max(20))
  .superRefine((list, ctx) => {
    if (Object.keys(list).length > Object.keys(PERMISSIONS).length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too many resources' });
      return;
    }
    for (const [resource, actions] of Object.entries(list)) {
      const declared = PERMISSIONS[resource as Resource] as Record<string, unknown> | undefined;
      for (const action of actions) {
        if (!declared || !Object.prototype.hasOwnProperty.call(declared, action)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown permission ${resource}.${action}` });
        }
      }
    }
  })
  .transform(canonical);

/** Sorted, de-duplicated, empty resources dropped — so equal lists compare and audit equal. */
function canonical(list: Record<string, string[]>): PermissionList {
  const out: PermissionList = {};
  for (const resource of Object.keys(list).sort()) {
    const actions = [...new Set(list[resource])].sort();
    if (actions.length > 0) out[resource] = actions;
  }
  return out;
}

function pgCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function rethrow(err: unknown): never {
  if (pgCode(err) === '23505') throw new TRPCError({ code: 'CONFLICT', message: 'يوجد دور بنفس الاسم.' });
  if (pgCode(err) === '23503') throw new TRPCError({ code: 'CONFLICT', message: 'الدور مُسند لأعضاء، ولا يمكن حذفه.' });
  throw err;
}

export const rolesRouter = router({
  list: requirePermission('roles', 'view').query(async ({ ctx }) => {
    const rows = await ctx.withOrg((tx) => tx
      .select({
        id: accessRoles.id,
        name: accessRoles.name,
        principalKind: accessRoles.principalKind,
        systemKey: accessRoles.systemKey,
        permissions: accessRoles.permissions,
        updatedAt: accessRoles.updatedAt,
        memberCount: sql<number>`(
          SELECT count(*)::int FROM ${orgMembers}
          WHERE ${orgMembers.accessRoleId} = ${accessRoles.id} AND ${orgMembers.orgId} = ${accessRoles.orgId}
        )`,
      })
      .from(accessRoles)
      .where(eq(accessRoles.orgId, ctx.orgId))
      .orderBy(sql`${accessRoles.systemKey} IS NULL`, asc(accessRoles.createdAt)));

    // A system role's list is the matrix, derived here, never stored.
    const data = rows.map((r) => ({
      ...r,
      isSystem: r.systemKey !== null,
      permissions: r.systemKey ? permissionsForRole(r.systemKey) : r.permissions,
    }));
    return { data, error: null, meta: null };
  }),

  create: requirePermission('roles', 'manage')
    .input(z.object({ name: nameSchema, principalKind: principalKindSchema, permissions: permissionListSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.withOrg((tx) => withAudit(
          tx,
          async () => {
            const [created] = await tx.insert(accessRoles).values({
              orgId: ctx.orgId,
              name: input.name,
              principalKind: input.principalKind,
              permissions: input.permissions,
              createdBy: ctx.userId,
            }).returning();
            return created;
          },
          { orgId: ctx.orgId, userId: ctx.userId, action: 'CREATE_ROLE', tableName: 'access_roles', changes: input },
        ));
        return { data: row, error: null, meta: null };
      } catch (err) {
        rethrow(err);
      }
    }),

  update: requirePermission('roles', 'manage')
    .input(z.object({
      id: z.string().uuid(),
      name: nameSchema.optional(),
      principalKind: principalKindSchema.optional(),
      permissions: permissionListSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      try {
        const row = await ctx.withOrg(async (tx) => {
          const [before] = await tx.select().from(accessRoles)
            .where(and(eq(accessRoles.id, id), eq(accessRoles.orgId, ctx.orgId)));
          if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود.' });
          if (before.systemKey) throw new TRPCError({ code: 'FORBIDDEN', message: 'أدوار النظام لا تُعدَّل. انسخ الدور ثم عدّل النسخة.' });

          return withAudit(
            tx,
            async () => {
              const [updated] = await tx.update(accessRoles)
                .set({ ...changes, updatedAt: new Date() })
                // system_key IS NULL again here: the check above is for the
                // message, this is the guard.
                .where(and(eq(accessRoles.id, id), eq(accessRoles.orgId, ctx.orgId), isNull(accessRoles.systemKey)))
                .returning();
              if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود.' });
              return updated;
            },
            {
              orgId: ctx.orgId, userId: ctx.userId, action: 'UPDATE_ROLE', tableName: 'access_roles',
              changes: {
                from: { name: before.name, principalKind: before.principalKind, permissions: before.permissions },
                to: changes,
              },
            },
          );
        });
        return { data: row, error: null, meta: null };
      } catch (err) {
        rethrow(err);
      }
    }),

  delete: requirePermission('roles', 'manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.withOrg(async (tx) => {
          const [target] = await tx.select({
            id: accessRoles.id, name: accessRoles.name, systemKey: accessRoles.systemKey, permissions: accessRoles.permissions,
          }).from(accessRoles).where(and(eq(accessRoles.id, input.id), eq(accessRoles.orgId, ctx.orgId)));
          if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود.' });
          if (target.systemKey) throw new TRPCError({ code: 'FORBIDDEN', message: 'أدوار النظام لا تُحذف.' });
          const [{ members }] = await tx.select({ members: count() }).from(orgMembers)
            .where(and(eq(orgMembers.accessRoleId, target.id), eq(orgMembers.orgId, ctx.orgId)));
          if (members > 0) throw new TRPCError({ code: 'CONFLICT', message: 'الدور مُسند لأعضاء، ولا يمكن حذفه.' });

          return withAudit(
            tx,
            async () => {
              // Guards in the WHERE: never a system role, never one with
              // members. A member assigned between the count above and this
              // statement makes the FK refuse the delete (23503 → CONFLICT).
              const [deleted] = await tx.delete(accessRoles)
                .where(and(
                  eq(accessRoles.id, target.id),
                  eq(accessRoles.orgId, ctx.orgId),
                  isNull(accessRoles.systemKey),
                  sql`NOT EXISTS (SELECT 1 FROM ${orgMembers} WHERE ${orgMembers.accessRoleId} = ${accessRoles.id})`,
                ))
                .returning({ id: accessRoles.id });
              if (!deleted) throw new TRPCError({ code: 'CONFLICT', message: 'الدور مُسند لأعضاء، ولا يمكن حذفه.' });
              return deleted;
            },
            {
              orgId: ctx.orgId, userId: ctx.userId, action: 'DELETE_ROLE', tableName: 'access_roles',
              changes: { name: target.name, permissions: target.permissions },
            },
          );
        });
        return { data: row, error: null, meta: null };
      } catch (err) {
        rethrow(err);
      }
    }),
});
