import { z } from 'zod';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { eq } from 'drizzle-orm';
import { orgFeatureFlags, orgSettings, withAudit } from '@irth/db';
import { DEFAULT_SETTINGS, SENSITIVE_KEYS } from '../../lib/settings';

const MASK_STRING = '••••••••';

export const settingsRouter = router({
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const dbSettings = await ctx.db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, ctx.orgId));

    const settingsMap: Record<string, string> = { ...DEFAULT_SETTINGS };

    for (const setting of dbSettings) {
      if ((SENSITIVE_KEYS as readonly string[]).includes(setting.key) && setting.value) {
        settingsMap[setting.key] = MASK_STRING;
      } else {
        settingsMap[setting.key] = setting.value;
      }
    }

    return { data: settingsMap, error: null, meta: null };
  }),

  myScreens: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        enabledScreens: orgFeatureFlags.enabledScreens,
        disabledScreens: orgFeatureFlags.disabledScreens,
      })
      .from(orgFeatureFlags)
      .where(eq(orgFeatureFlags.orgId, ctx.orgId))
      .limit(1);

    const config = rows[0];
    if (!config) {
      return {
        data: { unrestricted: true, enabledScreens: null, disabledScreens: null },
        error: null,
        meta: null,
      };
    }

    return {
      data: {
        unrestricted: false,
        enabledScreens: config.enabledScreens,
        disabledScreens: config.disabledScreens,
      },
      error: null,
      meta: null,
    };
  }),

  set: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
      const parsedInput = z.object({ key: z.string(), value: z.string() }).parse(input);

      await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          await tx
            .insert(orgSettings)
            .values({
              orgId: ctx.orgId,
              key: parsedInput.key,
              value: parsedInput.value,
              updatedBy: ctx.userId,
            })
            .onConflictDoUpdate({
              target: [orgSettings.orgId, orgSettings.key],
              set: {
                value: parsedInput.value,
                updatedBy: ctx.userId,
                updatedAt: new Date(),
              },
            });
          return {};
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'UPDATE_SETTING',
          tableName: 'org_settings',
          // Never write secret values into the audit trail.
          changes: {
            key: parsedInput.key,
            value: (SENSITIVE_KEYS as readonly string[]).includes(parsedInput.key) ? MASK_STRING : parsedInput.value,
          },
        }
      ));

      return { data: { success: true }, error: null, meta: null };
    }),

  setMany: adminProcedure
    .input(z.array(z.object({
      key: z.string(),
      value: z.string()
    })))
    .mutation(async ({ ctx, input }) => {
      const parsedInput = z.array(z.object({ key: z.string(), value: z.string() })).parse(input);

      const writtenKeys: string[] = [];
      for (const item of parsedInput) {
        if ((SENSITIVE_KEYS as readonly string[]).includes(item.key) && item.value === MASK_STRING) {
          continue;
        }

        await ctx.withOrg(async (tx) => tx
          .insert(orgSettings)
          .values({
            orgId: ctx.orgId,
            key: item.key,
            value: item.value,
            updatedBy: ctx.userId,
          })
          .onConflictDoUpdate({
            target: [orgSettings.orgId, orgSettings.key],
            set: {
              value: item.value,
              updatedBy: ctx.userId,
              updatedAt: new Date(),
            },
          }));
        writtenKeys.push(item.key);
      }

      if (writtenKeys.length > 0) {
        await ctx.withOrg((tx) => withAudit(
          tx,
          async () => ({}),
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'UPDATE_SETTINGS',
            tableName: 'org_settings',
            // Key names only — values may contain secrets.
            changes: { keys: writtenKeys },
          }
        ));
      }

      return { data: { success: true }, error: null, meta: null };
    }),
});
