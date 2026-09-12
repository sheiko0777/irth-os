import { z } from 'zod';
import { protectedProcedure, router, adminProcedure } from '../trpc';
import { stocktakingSessions, stocktakingItems, inventoryItems, inventoryMovements, productVariants, products, withAudit, postJournalEntry, ACCOUNT_CODES } from '@irth/db';
import { eq, and, desc, count, sql, ne, isNotNull, inArray, getTableColumns } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { assertSupportedCurrency } from '@irth/domain';

export const stocktakingRouter = router({
  sessions: router({
    list: protectedProcedure
      .input(z.object({}).optional())
      .query(async ({ ctx }) => {
        const sessions = await ctx.db
          .select({
            ...getTableColumns(stocktakingSessions),
            itemCount: count(stocktakingItems.id),
            varianceCount: sql<number>`COALESCE(COUNT(CASE WHEN ${stocktakingItems.variance} != 0 AND ${stocktakingItems.actualQuantity} IS NOT NULL THEN 1 END), 0)`,
          })
          .from(stocktakingSessions)
          .leftJoin(stocktakingItems, eq(stocktakingSessions.id, stocktakingItems.sessionId))
          .where(eq(stocktakingSessions.orgId, ctx.orgId))
          .groupBy(stocktakingSessions.id)
          .orderBy(desc(stocktakingSessions.createdAt))
          .limit(50);

        const sessionsWithCounts = sessions.map((s) => {
          return {
            ...s,
            itemCount: Number(s.itemCount ?? 0),
            varianceCount: Number(s.varianceCount ?? 0),
          };
        });

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
          // Signed value of the variance, in minor units: positive is a net
          // overage (inventory is worth more than the books said), negative a
          // net shortage. Only lines with a known average cost contribute —
          // see varianceLinesUncosted below for how many did not.
          let varianceValueMinor = 0n;
          let varianceLinesUncosted = 0;
          const itemsSkipped: Array<{ sku: string; reason: string }> = [];

          // Batch-resolve the two per-line lookups the loop below used to run
          // once per item: sku->variant (only for lines with no variantId
          // already recorded) and variant->inventory_item. One inArray() SELECT
          // each instead of up to 2*N round-trips for an N-line stocktake.
          // Scoped through products: `sku` is unique per org (0040), so an
          // unscoped lookup can resolve another tenant's variant.
          const unresolvedSkus = [...new Set(items.filter((i) => !i.variantId).map((i) => i.sku))];
          const variantIdBySku = new Map<string, string>();
          if (unresolvedSkus.length > 0) {
            const variantRows = await tx
              .select({ id: productVariants.id, sku: productVariants.sku })
              .from(productVariants)
              .innerJoin(products, eq(productVariants.productId, products.id))
              .where(and(
                inArray(productVariants.sku, unresolvedSkus),
                eq(products.orgId, ctx.orgId)
              ));
            for (const row of variantRows) variantIdBySku.set(row.sku, row.id);
          }

          const resolvedVariantIdByItemId = new Map<string, string>();
          for (const item of items) {
            const resolved = item.variantId ?? variantIdBySku.get(item.sku) ?? null;
            if (resolved) resolvedVariantIdByItemId.set(item.id, resolved);
          }

          const allResolvedVariantIds = [...new Set(resolvedVariantIdByItemId.values())];
          const invItemByVariantId = new Map<string, typeof inventoryItems.$inferSelect>();
          if (allResolvedVariantIds.length > 0) {
            const invRows = await tx
              .select()
              .from(inventoryItems)
              .where(and(
                inArray(inventoryItems.variantId, allResolvedVariantIds),
                eq(inventoryItems.orgId, ctx.orgId)
              ));
            for (const row of invRows) invItemByVariantId.set(row.variantId, row);
          }

          for (const item of items) {
            itemsCounted++;
            const counted = item.actualQuantity ?? 0;
            const variance = counted - (item.expectedQuantity ?? 0);
            netVariance += variance;
            absVariance += Math.abs(variance);

            const resolvedVariantId = resolvedVariantIdByItemId.get(item.id) ?? null;

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

            const invItem = invItemByVariantId.get(resolvedVariantId);

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

              // Valued at the item's current average cost — the same figure
              // costing.ts uses for everything else. NULL means this item has
              // never been received with a known cost, so its variance has no
              // value to attribute; counted separately below rather than
              // silently treated as zero-value.
              // `== null`, not `!== null`: catches `undefined` as well as
              // `null` — a defensive habit worth keeping regardless of what
              // the current SELECT happens to return, since `BigInt(x) *
              // undefined` throws rather than producing a sensible value.
              if (invItem.averageCostMinor == null) {
                varianceLinesUncosted++;
              } else {
                varianceValueMinor += BigInt(variance) * invItem.averageCostMinor;
              }
            }

            await tx
              .update(stocktakingItems)
              .set({ variance, appliedQuantity: counted })
              .where(and(eq(stocktakingItems.id, item.id), eq(stocktakingItems.orgId, ctx.orgId)));

            itemsApplied++;
          }

          // One entry for the whole session's variance, not one per line —
          // the individual movements already carry per-line detail via
          // inventory_movements; the ledger records the net financial effect
          // of completing this count. An overage debits Inventory (the asset
          // is worth more than the books said) and credits the variance
          // account as a gain; a shortage is the mirror image.
          if (varianceValueMinor !== 0n) {
            const memo = varianceLinesUncosted > 0
              ? `${varianceLinesUncosted} line(s) had no known cost basis and are excluded from this figure`
              : undefined;
            const magnitude = varianceValueMinor > 0n ? varianceValueMinor : -varianceValueMinor;
            // Provisional: defaulted to EGP pending stocktaking variance acquiring a natural currency.
            const lines = varianceValueMinor > 0n
              ? [
                  { accountCode: ACCOUNT_CODES.INVENTORY, currency: assertSupportedCurrency('EGP'), debitMinor: magnitude, memo },
                  { accountCode: ACCOUNT_CODES.INVENTORY_VARIANCE, currency: assertSupportedCurrency('EGP'), creditMinor: magnitude, memo },
                ]
              : [
                  { accountCode: ACCOUNT_CODES.INVENTORY_VARIANCE, currency: assertSupportedCurrency('EGP'), debitMinor: magnitude, memo },
                  { accountCode: ACCOUNT_CODES.INVENTORY, currency: assertSupportedCurrency('EGP'), creditMinor: magnitude, memo },
                ];

            await postJournalEntry(tx, {
              orgId: ctx.orgId,
              journalType: 'inventory',
              description: `Stocktake variance — session ${session.id}`,
              sourceTable: 'stocktaking_sessions',
              sourceId: session.id,
              createdBy: ctx.userId ?? null,
              lines,
            });
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