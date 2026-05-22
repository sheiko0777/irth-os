import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { courierShipments, courierRemittances } from '@irth/db';
import { eq, and, sql, sum, inArray, count } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const courierRouter = router({
  shipments: router({
    list: protectedProcedure
      .input(z.object({
        courier: z.string().optional(),
        status: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const conditions = [eq(courierShipments.orgId, ctx.orgId)];
        if (input.courier) {
          conditions.push(eq(courierShipments.courier, input.courier));
        }
        if (input.status) {
          conditions.push(eq(courierShipments.courierStatus, input.status));
        }

        const data = await ctx.db
          .select()
          .from(courierShipments)
          .where(and(...conditions));

        return { data, error: null, meta: null };
      }),

    markRemitted: protectedProcedure
      .input(z.object({
        shipmentId: z.string().uuid(),
        remittanceId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [updated] = await ctx.db
          .update(courierShipments)
          .set({ codRemitted: true, remittanceId: input.remittanceId })
          .where(and(
            eq(courierShipments.id, input.shipmentId),
            eq(courierShipments.orgId, ctx.orgId)
          ))
          .returning();

        return { data: updated, error: null, meta: null };
      }),
  }),

  remittances: router({
    list: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const conditions = [eq(courierRemittances.orgId, ctx.orgId)];
        if (input.status) {
          conditions.push(eq(courierRemittances.status, input.status));
        }

        const data = await ctx.db
          .select()
          .from(courierRemittances)
          .where(and(...conditions));

        return { data, error: null, meta: null };
      }),

    create: protectedProcedure
      .input(z.object({
        courier: z.string(),
        reference: z.string(),
        amount: z.string(), // decimal stored as string
        shipmentCount: z.number().int(),
        expectedDate: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [newRemittance] = await ctx.db
          .insert(courierRemittances)
          .values({
            orgId: ctx.orgId,
            courier: input.courier,
            remittanceReference: input.reference,
            amount: input.amount,
            shipmentCount: input.shipmentCount,
            expectedDate: input.expectedDate,
            status: 'pending',
          })
          .returning();

        return { data: newRemittance, error: null, meta: null };
      }),

    reconcile: protectedProcedure
      .input(z.object({
        remittanceId: z.string().uuid(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [remittance] = await ctx.db
          .select()
          .from(courierRemittances)
          .where(and(
            eq(courierRemittances.id, input.remittanceId),
            eq(courierRemittances.orgId, ctx.orgId)
          ));

        if (!remittance) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Remittance not found' });
        }

        const [updatedRemittance] = await ctx.db
          .update(courierRemittances)
          .set({ status: 'reconciled', receivedDate: new Date() })
          .where(eq(courierRemittances.id, remittance.id))
          .returning();

        await ctx.db
          .update(courierShipments)
          .set({ codRemitted: true })
          .where(and(
            eq(courierShipments.remittanceId, remittance.remittanceReference),
            eq(courierShipments.orgId, ctx.orgId)
          ));

        return { data: updatedRemittance, error: null, meta: null };
      }),
  }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    // We will run the aggregations using Promise.all per the memory guidelines
    const [collectedRes, remittedRes, unremittedRes, statusesRes] = await Promise.all([
      ctx.db.select({ total: sum(sql`CAST(${courierShipments.codAmount} AS numeric)`) })
        .from(courierShipments)
        .where(and(eq(courierShipments.orgId, ctx.orgId), eq(courierShipments.codCollected, true))),

      ctx.db.select({ total: sum(sql`CAST(${courierShipments.codAmount} AS numeric)`) })
        .from(courierShipments)
        .where(and(eq(courierShipments.orgId, ctx.orgId), eq(courierShipments.codRemitted, true))),

      ctx.db.select({ total: sum(sql`CAST(${courierShipments.codAmount} AS numeric)`) })
        .from(courierShipments)
        .where(and(eq(courierShipments.orgId, ctx.orgId), eq(courierShipments.codCollected, true), eq(courierShipments.codRemitted, false))),

      ctx.db.select({ status: courierShipments.courierStatus, count: count() })
        .from(courierShipments)
        .where(eq(courierShipments.orgId, ctx.orgId))
        .groupBy(courierShipments.courierStatus)
    ]);

    const shipmentsByStatus = statusesRes.reduce((acc: Record<string, number>, curr: { status: string; count: number }) => {
      acc[curr.status] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    return {
      data: {
        totalCodCollected: Number(collectedRes[0]?.total ?? 0),
        totalCodRemitted: Number(remittedRes[0]?.total ?? 0),
        pendingRemittance: Number(unremittedRes[0]?.total ?? 0),
        shipmentsByStatus,
      },
      error: null,
      meta: null
    };
  }),
});
