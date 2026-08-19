import { z } from 'zod';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { stocktakingSessions, stocktakingItems, inventoryItems, inventoryMovements, productVariants, products, withAudit } from '@irth/db';
import { eq, and, desc, count, sql, ne, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const stocktakingRouter = router({
  sessions: router({
    list: protectedProcedure
      .input(z.object({}).optional())
      .query(async ({ ctx }) => {
        const sessions = await ctx.db
          .select()
          .from(stocktakingSessions)
          .where(eq(stocktakingSessions.orgId, ctx.orgId))
          .orderBy(desc(stocktakingSessions.createdAt))
          .limit(50);

        const sessionsWithCounts = await Promise.all(
          sessions.map(async (s) => {
            const [counts] = await ctx.db
              .select({
                itemCount: count(stocktakingItems.id),
                varianceCount: sql<number>`COALESCE(COUNT(CASE WHEN ${stocktakingItems.variance} != 0 AND ${stocktakingItems.actualQuantity} IS NOT NULL THEN 1 END), 0)`,
              })
              .from(stocktakingItems)
              .where(eq(stocktakingItems.sessionId, s.id));
            return {
              ...s,
              itemCount: Number(counts?.itemCount ?? 0),
              varianceCount: Number(counts?.varianceCount ?? 0),
            };
          })
        );

        return { data: sessionsWithCounts, error: null };
      }),

    create: adminProcedure
      .input(z.object({ notes: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const [session] = await ctx.withOrg(async (tx) => tx
          .insert(stocktakingSessions)
          .values({
            orgId: ctx.orgId,
            status: 'in_progress',
            startedAt: new Date(),
            notes: input.notes ?? null,
          })
          .returning());
        return { data: session, error: null };
      }),

    complete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // Completing a stocktake applies the counted quantities to inventory.
        // Everything below is one transaction: a crash must not leave a session
        // marked completed with counts half-applied. The status guard in the
        // WHERE clause is what makes the whole thing idempotent — only an open
        // session can be completed, so counts can never be applied twice.
        const result = await ctx.withOrg(async (tx) => {
          const [session] = await tx
            .update(stocktakingSessions)
            .set({
              status: 'completed',
              completedAt: new Date(),
              appliedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(stocktakingSessions.id, input.id),
                eq(stocktakingSessions.orgId, ctx.orgId),
                ne(stocktakingSessions.status, 'completed')
              )
            )
            .returning();

          if (!session) {
            const [existing] = await tx
              .select({ status: stocktakingSessions.status })
              .from(stocktakingSessions)
              .where(and(
                eq(stocktakingSessions.id, input.id),
                eq(stocktakingSessions.orgId, ctx.orgId)
              ))
              .limit(1);
            if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Session already completed' });
          }

          // Only counted lines participate. A line with actualQuantity NULL was
          // never counted — it is not a count of zero and must not zero stock.
          const items = await tx
            .select()
            .from(stocktakingItems)
            .where(
              and(
                eq(stocktakingItems.sessionId, session.id),
                eq(stocktakingItems.orgId, ctx.orgId),
                isNotNull(stocktakingItems.actualQuantity)
              )
            );

          let itemsCounted = 0;
          let itemsApplied = 0;
          let netVariance = 0;
          let absVariance = 0;
          const itemsSkipped: Array<{ sku: string; reason: string }> = [];

          for (const item of items) {
            itemsCounted++;
            const counted = item.actualQuantity ?? 0;
            const variance = counted - (item.expectedQuantity ?? 0);
            netVariance += variance;
            absVariance += Math.abs(variance);

            let resolvedVariantId = item.variantId;
            if (!resolvedVariantId) {
              // productVariants has no orgId and `sku` is globally unique, so an
              // unscoped lookup resolves another tenant's variant. Scope through
              // products.
              const [variant] = await tx
                .select({ id: productVariants.id })
                .from(productVariants)
                .innerJoin(products, eq(productVariants.productId, products.id))
                .where(and(
                  eq(productVariants.sku, item.sku),
                  eq(products.orgId, ctx.orgId)
                ))
                .limit(1);
              if (variant) resolvedVariantId = variant.id;
            }

            // Unresolvable lines still record their variance — the count did
            // happen — but appliedQuantity stays NULL, because nothing was
            // written to stock. A non-null appliedQuantity must always mean
            // "this value actually reached inventory".
            if (!resolvedVariantId) {
              itemsSkipped.push({ sku: item.sku, reason: 'variant_not_found' });
              await tx.update(stocktakingItems).set({ variance })
                .where(and(eq(stocktakingItems.id, item.id), eq(stocktakingItems.orgId, ctx.orgId)));
              continue;
            }

            const [invItem] = await tx
              .select()
              .from(inventoryItems)
              .where(and(
                eq(inventoryItems.variantId, resolvedVariantId),
                eq(inventoryItems.orgId, ctx.orgId)
              ))
              .limit(1);

            if (!invItem) {
              itemsSkipped.push({ sku: item.sku, reason: 'inventory_record_not_found' });
              await tx.update(stocktakingItems).set({ variance })
                .where(and(eq(stocktakingItems.id, item.id), eq(stocktakingItems.orgId, ctx.orgId)));
              continue;
            }

            // A stocktake SETS stock to the counted value rather than adding to
            // it. Matching inventory.adjust's convention, an absolute correction
            // is recorded as type 'adjustment' with the new absolute value.
            if (variance !== 0) {
              await tx
                .update(inventoryItems)
                // `counted` is absolute on purpose — a stocktake asserts what
                // the quantity IS, so unlike inventory.adjust's in/out this is
                // not a lost update waiting to happen.
                .set({ quantity: counted, updatedAt: new Date() })
                // orgId as well as id: invItem came from an org-scoped read,
                // but a write must be correct on its own rather than relying on
                // an earlier statement having been right.
                .where(and(
                  eq(inventoryItems.id, invItem.id),
                  eq(inventoryItems.orgId, ctx.orgId),
                ));

              await tx.insert(inventoryMovements).values({
                orgId: ctx.orgId,
                itemId: invItem.id,
                type: 'adjustment',
                quantity: counted,
                note: `Stocktake ${session.id}`,
              });
            }

            await tx
              .update(stocktakingItems)
              .set({ variance, appliedQuantity: counted })
              .where(and(eq(stocktakingItems.id, item.id), eq(stocktakingItems.orgId, ctx.orgId)));

            itemsApplied++;
          }

          await withAudit(
            tx,
            async () => session,
            {
              orgId: ctx.orgId,
              userId: ctx.userId ?? null,
              action: 'RECONCILE_STOCKTAKE',
              tableName: 'stocktaking_sessions',
              changes: {
                sessionId: session.id,
                itemsCounted,
                itemsApplied,
                itemsSkipped: itemsSkipped.length,
                netVariance,
                absVariance,
              },
            }
          );

          return {
            session,
            summary: { itemsCounted, itemsApplied, itemsSkipped, netVariance, absVariance },
          };
        });

        return { data: result.session, summary: result.summary, error: null };
      }),

    getItems: protectedProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const items = await ctx.db
          .select()
          .from(stocktakingItems)
          .where(
            and(
              eq(stocktakingItems.sessionId, input.sessionId),
              eq(stocktakingItems.orgId, ctx.orgId)
            )
          )
          .orderBy(stocktakingItems.productName);
        return { data: items, error: null };
      }),
  }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    const allSessions = await ctx.db
      .select({
        status: stocktakingSessions.status,
        completedAt: stocktakingSessions.completedAt,
      })
      .from(stocktakingSessions)
      .where(eq(stocktakingSessions.orgId, ctx.orgId));

    const totalSessions = allSessions.length;
    const activeSessions = allSessions.filter((s) => s.status === 'in_progress').length;
    const completed = allSessions.filter((s) => s.status === 'completed' && s.completedAt);
    const lastCompletedAt =
      completed.length > 0
        ? completed.reduce((a, b) => (a.completedAt! > b.completedAt! ? a : b)).completedAt
        : null;

    return { data: { totalSessions, activeSessions, lastCompletedAt }, error: null };
  }),
});