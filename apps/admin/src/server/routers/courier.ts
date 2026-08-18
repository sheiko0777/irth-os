import { router, protectedProcedure, adminProcedure } from '../trpc';
import { z } from 'zod';
import { courierShipments, courierRemittances, withAudit } from '@irth/db';
import { fromMinor, parseDecimal } from '@irth/domain';
import { eq, and, ne, sql, sum, inArray, count } from 'drizzle-orm';
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

    markRemitted: adminProcedure
      .input(z.object({
        shipmentId: z.string().uuid(),
        remittanceId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const updated = await withAudit(
          ctx.db,
          async () => {
            const [row] = await ctx.db
              .update(courierShipments)
              .set({ codRemitted: true, remittanceId: input.remittanceId })
              .where(and(
                eq(courierShipments.id, input.shipmentId),
                eq(courierShipments.orgId, ctx.orgId)
              ))
              .returning();
            return row;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'MARK_SHIPMENT_REMITTED',
            tableName: 'courier_shipments',
            changes: input,
          }
        );

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

    create: adminProcedure
      .input(z.object({
        courier: z.string(),
        reference: z.string(),
        // Accepted as a decimal string from the client and parsed exactly.
        // parseDecimal never constructs a float, so "1234.56" cannot arrive as
        // 1234.5600000000001 the way Number(...) would allow.
        amount: z.string(),
        shipmentCount: z.number().int(),
        expectedDate: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const newRemittance = await withAudit(
          ctx.db,
          async () => {
            const [row] = await ctx.db
              .insert(courierRemittances)
              .values({
                orgId: ctx.orgId,
                courier: input.courier,
                remittanceReference: input.reference,
                amountMinor: parseDecimal(input.amount).minor,
                shipmentCount: input.shipmentCount,
                expectedDate: input.expectedDate,
                status: 'pending',
              })
              .returning();
            return row;
          },
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'CREATE_REMITTANCE',
            tableName: 'courier_remittances',
            changes: input as unknown as Record<string, unknown>,
          }
        );

        return { data: newRemittance, error: null, meta: null };
      }),

    reconcile: adminProcedure
      .input(z.object({
        remittanceId: z.string().uuid(),
      }))
      .mutation(async ({ ctx, input }) => {
        // This was THREE separate autocommits: the remittance status, the audit
        // row (withAudit was handed ctx.db rather than a transaction), and the
        // shipments. A failure between any two left the remittance marked
        // reconciled while its shipments still showed COD outstanding — money
        // state that diverges permanently, with no report that would surface it.
        //
        // Now one transaction, scoped to the tenant by RLS as well as by the
        // WHERE clauses.
        const updatedRemittance = await ctx.withOrg(async (tx) => {
          const [remittance] = await tx
            .select()
            .from(courierRemittances)
            .where(and(
              eq(courierRemittances.id, input.remittanceId),
              eq(courierRemittances.orgId, ctx.orgId)
            ));

          if (!remittance) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Remittance not found' });
          }

          // Idempotency without a key: only a remittance that is not already
          // reconciled can transition. A double submit updates zero rows and
          // throws below, rather than writing a second audit row and
          // re-stamping receivedDate. The guard lives in the WHERE so a
          // concurrent caller cannot slip between the check and the write.
          const [row] = await tx
            .update(courierRemittances)
            .set({ status: 'reconciled', receivedDate: new Date() })
            .where(and(
              eq(courierRemittances.id, remittance.id),
              // orgId was missing from this UPDATE. The SELECT above is
              // org-scoped so it was not exploitable, but the check and the
              // write were separate statements — single-layer defence on a
              // money-moving write.
              eq(courierRemittances.orgId, ctx.orgId),
              ne(courierRemittances.status, 'reconciled')
            ))
            .returning();

          if (!row) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Remittance is already reconciled',
            });
          }

          await tx
            .update(courierShipments)
            .set({ codRemitted: true })
            .where(and(
              eq(courierShipments.remittanceId, remittance.remittanceReference),
              eq(courierShipments.orgId, ctx.orgId)
            ));

          // Inside the transaction, so the audit row lands with the change it
          // describes or not at all.
          await withAudit(tx, async () => row, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'RECONCILE_REMITTANCE',
            tableName: 'courier_remittances',
            changes: { remittanceId: input.remittanceId },
          });

          return row;
        });

        return { data: updatedRemittance, error: null, meta: null };
      }),
  }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    // We will run the aggregations using Promise.all per the memory guidelines
    const [collectedRes, remittedRes, unremittedRes, statusesRes] = await Promise.all([
      // The CAST is gone with the column: cod_amount_minor is already bigint,
      // so sum() aggregates it natively.
      ctx.db.select({ total: sum(courierShipments.codAmountMinor) })
        .from(courierShipments)
        .where(and(eq(courierShipments.orgId, ctx.orgId), eq(courierShipments.codCollected, true))),

      ctx.db.select({ total: sum(courierShipments.codAmountMinor) })
        .from(courierShipments)
        .where(and(eq(courierShipments.orgId, ctx.orgId), eq(courierShipments.codRemitted, true))),

      ctx.db.select({ total: sum(courierShipments.codAmountMinor) })
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
        // sum() returns a numeric string (null when nothing matched). BigInt
        // keeps it exact; Number would silently cap at 2^53 and reintroduce a
        // float for the COD balance the courier actually owes us.
        totalCodCollected: fromMinor(BigInt((collectedRes[0]?.total as string | null) ?? '0')),
        totalCodRemitted: fromMinor(BigInt((remittedRes[0]?.total as string | null) ?? '0')),
        pendingRemittance: fromMinor(BigInt((unremittedRes[0]?.total as string | null) ?? '0')),
        shipmentsByStatus,
      },
      error: null,
      meta: null
    };
  }),
});
