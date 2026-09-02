import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { accessProfiles, orgMembers, warehouses, withAudit } from '@irth/db';
import { ownerProcedure, router } from '../trpc';

const keySchema = z.string().regex(/^(?:screen\.[a-z-]+|(?:products|categories|members|orders|coupons|campaigns|inventory|returns|purchasing|finance|customers|courier|integrations)\.(?:view|write|delete|invite|changeRole|remove|connect|manage))$/);
const policySchema = z.object({
  allow: z.array(keySchema).max(100).default([]),
  deny: z.array(keySchema).max(100).default([]),
  screens: z.array(z.string().regex(/^[a-z-]+$/)).max(50).default([]),
}).strict();

export const accessProfilesRouter = router({
  list: ownerProcedure.query(async ({ ctx }) => ({
    data: await ctx.db.select().from(accessProfiles).where(eq(accessProfiles.orgId, ctx.orgId)),
    error: null,
    meta: null,
  })),

  create: ownerProcedure
    .input(z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), policy: policySchema }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [row] = await tx.insert(accessProfiles).values({
          orgId: ctx.orgId, name: input.name, description: input.description ?? null,
          permissions: { allow: input.policy.allow, deny: input.policy.deny, screens: input.policy.screens },
          screens: input.policy.screens,
        }).returning();
        return row;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'CREATE_ACCESS_PROFILE', tableName: 'access_profiles', changes: { name: input.name } }));
      return { data: profile, error: null, meta: null };
    }),

  assignMember: ownerProcedure
    .input(z.object({
      memberId: z.string().uuid(), profileId: z.string().uuid().nullable(), jobTitle: z.string().trim().max(100).nullable(),
      warehouseIds: z.array(z.string().uuid()).max(50), overrides: policySchema,
    }))
    .mutation(async ({ ctx, input }) => ctx.withOrg(async (tx) => {
      const [member] = await tx.select().from(orgMembers).where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId))).limit(1);
      if (!member) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      if (member.role === 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner access cannot be narrowed here' });
      if (input.profileId) {
        const [profile] = await tx.select({ id: accessProfiles.id }).from(accessProfiles)
          .where(and(eq(accessProfiles.id, input.profileId), eq(accessProfiles.orgId, ctx.orgId))).limit(1);
        if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Access profile not found' });
      }
      if (input.warehouseIds.length) {
        const allowed = await tx.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.orgId, ctx.orgId), inArray(warehouses.id, input.warehouseIds)));
        if (allowed.length !== input.warehouseIds.length) throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid warehouse scope' });
      }
      const updated = await withAudit(tx, async () => {
        const [row] = await tx.update(orgMembers).set({
          accessProfileId: input.profileId, jobTitle: input.jobTitle, assignedWarehouseIds: input.warehouseIds,
          permissionOverrides: { allow: input.overrides.allow, deny: input.overrides.deny, screens: input.overrides.screens },
        }).where(and(eq(orgMembers.id, input.memberId), eq(orgMembers.orgId, ctx.orgId))).returning();
        return row;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'ASSIGN_MEMBER_ACCESS', tableName: 'org_members', changes: { memberId: input.memberId, profileId: input.profileId, warehouseIds: input.warehouseIds } });
      return { data: updated, error: null, meta: null };
    })),
});
