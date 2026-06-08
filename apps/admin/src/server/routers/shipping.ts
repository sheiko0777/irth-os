import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { shippingZones, shippingRates } from '@irth/db';
import { eq, and, count, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

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

        if (zones.length === 0) {
          return { data: [], error: null };
        }

        const zoneIds = zones.map((z) => z.id);

        const counts = await ctx.db
          .select({
            zoneId: shippingRates.zoneId,
            cnt: count(shippingRates.id),
          })
          .from(shippingRates)
          .where(inArray(shippingRates.zoneId, zoneIds))
          .groupBy(shippingRates.zoneId);

        const countsMap = new Map<string, number>();
        for (const row of counts) {
          if (row.zoneId) {
            countsMap.set(row.zoneId, Number(row.cnt));
          }
        }

        const zonesWithCounts = zones.map((zone) => {
          return {
            ...zone,
            countries: (zone.countries as string[]) ?? [],
            rateCount: countsMap.get(zone.id) ?? 0,
          };
        });

        return { data: zonesWithCounts, error: null };
      }),

    create: protectedProcedure
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

    setActive: protectedProcedure
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
            price: Number(r.price),
            minOrderValue: r.minOrderValue ? Number(r.minOrderValue) : null,
            maxOrderValue: r.maxOrderValue ? Number(r.maxOrderValue) : null,
            minWeight: r.minWeight ? Number(r.minWeight) : null,
            maxWeight: r.maxWeight ? Number(r.maxWeight) : null,
          })),
          error: null,
        };
      }),

    create: protectedProcedure
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
            price: input.price.toString(),
            minOrderValue: input.minOrderValue?.toString() ?? null,
            maxOrderValue: input.maxOrderValue?.toString() ?? null,
            minWeight: input.minWeight?.toString() ?? null,
            maxWeight: input.maxWeight?.toString() ?? null,
            estimatedDaysMin: input.estimatedDaysMin ?? null,
            estimatedDaysMax: input.estimatedDaysMax ?? null,
          })
          .returning();
        return { data: rate, error: null };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(shippingRates)
          .where(and(eq(shippingRates.id, input.id), eq(shippingRates.orgId, ctx.orgId)));
        return { success: true };
      }),
  }),
});
