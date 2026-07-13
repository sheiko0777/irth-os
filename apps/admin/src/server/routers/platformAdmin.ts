import { z } from 'zod';
import { platformAdminProcedure, router } from '../trpc';
import { organizations, orgMembers, orgFeatureFlags } from '@irth/db';
import { eq, count } from 'drizzle-orm';

const orgPlanSchema = z.enum(['starter', 'growth', 'enterprise']);

export const platformAdminRouter = router({
  listOrgs: platformAdminProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const orgList = await ctx.db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          brand: organizations.brand,
          memberCount: count(orgMembers.id),
        })
        .from(organizations)
        .leftJoin(orgMembers, eq(orgMembers.orgId, organizations.id))
        .groupBy(organizations.id)
        .orderBy(organizations.name);

      const configs = await ctx.db.select().from(orgFeatureFlags);
      const configMap: Record<string, typeof configs[number]> = {};
      for (const c of configs) configMap[c.orgId] = c;

      return {
        data: orgList.map((o) => ({ ...o, config: configMap[o.id] ?? null })),
        error: null,
      };
    }),

  getOrgConfig: platformAdminProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [config] = await ctx.db
        .select()
        .from(orgFeatureFlags)
        .where(eq(orgFeatureFlags.orgId, input.orgId))
        .limit(1);
      return { data: config ?? null, error: null };
    }),

  setOrgConfig: platformAdminProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        plan: orgPlanSchema,
        isActive: z.boolean(),
        enabledScreens: z.array(z.string()),
        disabledScreens: z.array(z.string()),
        maxUsers: z.number().int().positive().nullable(),
        notes: z.string().max(1000).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { orgId, ...fields } = input;
      const [result] = await ctx.db
        .insert(orgFeatureFlags)
        .values({ orgId, ...fields })
        .onConflictDoUpdate({
          target: orgFeatureFlags.orgId,
          set: { ...fields, updatedAt: new Date() },
        })
        .returning();
      return { data: result, error: null };
    }),

  resetConfig: platformAdminProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(orgFeatureFlags)
        .where(eq(orgFeatureFlags.orgId, input.orgId));
      return { data: { reset: true }, error: null };
    }),
});
