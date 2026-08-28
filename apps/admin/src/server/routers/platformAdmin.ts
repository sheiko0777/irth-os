import { z } from 'zod';
import { platformAdminProcedure, router } from '../trpc';
import { organizations, orgMembers, orgFeatureFlags, orgInvites, shippingZones, shippingRates, priceLists } from '@irth/db';
import { eq, count, desc } from 'drizzle-orm';
import { EGP, parseDecimal } from '@irth/domain';
import { DEFAULT_SETTINGS, SETTING_KEYS } from '../../lib/settings';

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

      const configs = await ctx.dbUnscoped.select().from(orgFeatureFlags);
      const configMap: Record<string, (typeof configs)[number]> = {};
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
      await ctx.dbUnscoped.delete(orgFeatureFlags).where(eq(orgFeatureFlags.orgId, input.orgId));
      return { data: { reset: true }, error: null };
    }),

  // --- Account creation ---

  createOrg: platformAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'slug: lowercase letters, numbers, hyphens only'),
        ownerEmail: z.string().email(),
        plan: orgPlanSchema,
        enabledScreens: z.array(z.string()),
        disabledScreens: z.array(z.string()),
        maxUsers: z.number().int().positive().nullable(),
        notes: z.string().max(1000).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const org = await ctx.dbUnscoped.transaction(async (tx) => {
        const [org] = await tx.insert(organizations)
          .values({ name: input.name, slug: input.slug, brand: 'irth' })
          .returning();

        await tx.insert(orgFeatureFlags).values({
          orgId: org.id,
          plan: input.plan,
          enabledScreens: input.enabledScreens,
          disabledScreens: input.disabledScreens,
          maxUsers: input.maxUsers,
          notes: input.notes,
        });

        await tx.insert(orgInvites).values({
          orgId: org.id,
          email: input.ownerEmail,
          token,
          role: 'owner',
          expiresAt,
        });

        // UX hygiene, not a bug fix: order/checkout logic never reads these
        // tables (order pricing comes from productVariants.priceMinor) and
        // every list screen already handles zero rows. Values mirror the same
        // DEFAULT_SETTINGS a new org would otherwise fall back to at read time
        // in settingsRouter's getAll, so the seeded shipping rate matches what
        // Settings already claims the flat rate to be. org_settings itself is
        // NOT seeded here — getAll already merges DEFAULT_SETTINGS over
        // whatever rows exist, so there is nothing for a missing row to break.
        const [zone] = await tx.insert(shippingZones)
          .values({ orgId: org.id, name: 'Default Zone', countries: ['EG'] })
          .returning();

        await tx.insert(shippingRates).values({
          zoneId: zone.id,
          orgId: org.id,
          name: 'Standard',
          rateType: 'flat',
          priceMinor: parseDecimal(DEFAULT_SETTINGS[SETTING_KEYS.shipping.flat_rate], EGP).minor,
        });

        await tx.insert(priceLists).values({ orgId: org.id, name: 'Default Price List', isDefault: true });

        return org;
      });

      return { data: { orgId: org.id, orgName: org.name, inviteToken: token }, error: null };
    }),

  listInvites: platformAdminProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const invites = await ctx.db
        .select()
        .from(orgInvites)
        .where(eq(orgInvites.orgId, input.orgId))
        .orderBy(desc(orgInvites.createdAt));
      return { data: invites, error: null };
    }),

  revokeInvite: platformAdminProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.dbUnscoped.delete(orgInvites).where(eq(orgInvites.id, input.inviteId));
      return { data: { revoked: true }, error: null };
    }),
});
