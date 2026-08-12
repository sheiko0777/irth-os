import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { shippingZones, shippingRates } from '@irth/db';
import { eq, and, count } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { EGP, fromMinor, parseDecimal } from '@irth/domain';

export const shippingRouter = router({
  zones: router({
    list: protectedProcedure
      .input(z.object({}).optional())
      .query(async ({ ctx }) => {
        const zones = await ctx.db
          .select()
          .from(shippingZones)
          .where(eq(shippingZones.orgId, ctx.orgId))
          .orderBy(shippingZones.name);

        const zonesWithCounts = await Promise.all(
          zones.map(async (zone) => {
            const [{ cnt }] = await ctx.db
              .select({ cnt: count(shippingRates.id) })
              .from(shippingRates)
              .where(eq(shippingRates.zoneId, zone.id));
            return {
              ...zone,
              countries: (zone.countries as string[]) ?? [],
              rateCount: Number(cnt ?? 0),
            };
          })
        );

        return { data: zonesWithCounts, error: null };
      }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          countries: z.array(z.string()).default([]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [zone] = await ctx.db
          .insert(shippingZones)
          .values({ orgId: ctx.orgId, name: input.name, countries: input.countries })
          .returning();
        return { data: zone, error: null };
      }),

    setActive: adminProcedure
      .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const [zone] = await ctx.db
          .update(shippingZones)
          .set({ isActive: input.isActive, updatedAt: new Date() })
          .where(and(eq(shippingZones.id, input.id), eq(shippingZones.orgId, ctx.orgId)))
          .returning();
        if (!zone) throw new TRPCError({ code: 'NOT_FOUND', message: 'Zone not found' });
        return { data: zone, error: null };
      }),
  }),

  rates: router({
    list: protectedProcedure
      .input(z.object({ zoneId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const rates = await ctx.db
          .select()
          .from(shippingRates)
          .where(
            and(
              eq(shippingRates.zoneId, input.zoneId),
              eq(shippingRates.orgId, ctx.orgId)
            )
          )
          .orderBy(shippingRates.name);

        return {
          data: rates.map((r) => ({
            ...r,
            price: fromMinor(r.priceMinor, EGP),
            minOrderValue: r.minOrderValueMinor == null ? null : fromMinor(r.minOrderValueMinor, EGP),
            maxOrderValue: r.maxOrderValueMinor == null ? null : fromMinor(r.maxOrderValueMinor, EGP),
            minWeight: r.minWeight ? Number(r.minWeight) : null,
            maxWeight: r.maxWeight ? Number(r.maxWeight) : null,
          })),
          error: null,
        };
      }),

    create: adminProcedure
      .input(
        z.object({
          zoneId: z.string().uuid(),
          name: z.string().min(1),
          rateType: z.enum(['flat', 'weight_based', 'price_based', 'free']),
          price: z.number().min(0).default(0),
          minOrderValue: z.number().optional(),
          maxOrderValue: z.number().optional(),
          minWeight: z.number().optional(),
          maxWeight: z.number().optional(),
          estimatedDaysMin: z.number().int().optional(),
          estimatedDaysMax: z.number().int().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [rate] = await ctx.db
          .insert(shippingRates)
          .values({
            orgId: ctx.orgId,
            zoneId: input.zoneId,
            name: input.name,
            rateType: input.rateType,
            priceMinor: parseDecimal(String(input.price), EGP).minor,
            minOrderValueMinor: input.minOrderValue == null ? null : parseDecimal(String(input.minOrderValue), EGP).minor,
            maxOrderValueMinor: input.maxOrderValue == null ? null : parseDecimal(String(input.maxOrderValue), EGP).minor,
            minWeight: input.minWeight?.toString() ?? null,
            maxWeight: input.maxWeight?.toString() ?? null,
            estimatedDaysMin: input.estimatedDaysMin ?? null,
            estimatedDaysMax: input.estimatedDaysMax ?? null,
          })
          .returning();
        return { data: rate, error: null };
      }),

    delete: ownerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(shippingRates)
          .where(and(eq(shippingRates.id, input.id), eq(shippingRates.orgId, ctx.orgId)));
        return { success: true };
      }),
  }),
});
