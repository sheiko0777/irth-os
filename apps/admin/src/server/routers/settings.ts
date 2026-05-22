import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { eq } from 'drizzle-orm';
import { orgSettings } from '@irth/db';
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

  set: protectedProcedure
    .input(z.object({
      key: z.string(),
      value: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
      const parsedInput = z.object({ key: z.string(), value: z.string() }).parse(input);

      await ctx.db
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

      return { data: { success: true }, error: null, meta: null };
    }),

  setMany: protectedProcedure
    .input(z.array(z.object({
      key: z.string(),
      value: z.string()
    })))
    .mutation(async ({ ctx, input }) => {
      const parsedInput = z.array(z.object({ key: z.string(), value: z.string() })).parse(input);

      for (const item of parsedInput) {
        if ((SENSITIVE_KEYS as readonly string[]).includes(item.key) && item.value === MASK_STRING) {
          continue;
        }

        await ctx.db
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
          });
      }

      return { data: { success: true }, error: null, meta: null };
    }),
});
