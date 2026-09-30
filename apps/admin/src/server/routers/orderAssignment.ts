import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { orders, orgMembers, repCashCollections, user, withAudit } from '@irth/db';
import { requirePermission } from '../trpc';

/**
 * Assigning orders to a delivery rep (PR-2a). Spread into the orders router,
 * so the procedures are `orders.reps` and `orders.assignRep`.
 *
 * Every guard is in the UPDATE's WHERE (CLAUDE.md rule 5): only this org's
 * orders, only ones still out for delivery (confirmed or shipped, a complete
 * import), and never one whose cash a rep has already collected — moving that
 * order would separate the cash from the rep who holds it.
 */
export const orderAssignmentProcedures = {
  /** Active delivery reps, for the assign picker. */
  reps: requirePermission('orders', 'assign')
    .query(async ({ ctx }) => {
      const rows = await ctx.withOrg((tx) => tx
        .select({ memberId: orgMembers.id, name: user.name, username: user.username })
        .from(orgMembers)
        .leftJoin(user, eq(user.id, orgMembers.userId))
        .where(and(
          eq(orgMembers.orgId, ctx.orgId),
          eq(orgMembers.principalKind, 'delivery_rep'),
          eq(orgMembers.status, 'active'),
        ))
        .orderBy(asc(user.name)));
      return { data: rows, error: null, meta: null };
    }),

  /** Assign (memberId) or unassign (null) up to 100 orders at once. */
  assignRep: requirePermission('orders', 'assign')
    .input(z.object({
      orderIds: z.array(z.string().uuid()).min(1).max(100),
      memberId: z.string().uuid().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orderIds = [...new Set(input.orderIds)];
      const assigned = await ctx.withOrg(async (tx) => {
        if (input.memberId) {
          // FOR SHARE: the rep cannot be suspended or re-kinded between this
          // check and the assignment committing.
          const [rep] = await tx.select({ id: orgMembers.id })
            .from(orgMembers)
            .where(and(
              eq(orgMembers.id, input.memberId),
              eq(orgMembers.orgId, ctx.orgId),
              eq(orgMembers.principalKind, 'delivery_rep'),
              eq(orgMembers.status, 'active'),
            ))
            .for('share');
          if (!rep) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'المندوب غير موجود أو موقوف.' });
          }
        }
        return withAudit(tx, async () => ({ id: input.memberId ?? undefined, rows: await tx.update(orders)
          .set({ assignedRepMemberId: input.memberId, updatedAt: sql`now()` })
          .where(and(
            eq(orders.orgId, ctx.orgId),
            inArray(orders.id, orderIds),
            inArray(orders.status, ['confirmed', 'shipped']),
            eq(orders.importStatus, 'complete'),
            notExists(tx.select({ one: sql`1` }).from(repCashCollections)
              .where(and(eq(repCashCollections.orgId, ctx.orgId), eq(repCashCollections.orderId, orders.id)))),
          ))
          .returning({ id: orders.id }) }), {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: input.memberId ? 'ASSIGN_ORDER_REP' : 'UNASSIGN_ORDER_REP',
          tableName: 'orders',
          changes: { orderIds, memberId: input.memberId },
        });
      });
      return {
        data: { assigned: assigned.rows.map((r) => r.id), skipped: orderIds.length - assigned.rows.length },
        error: null,
        meta: null,
      };
    }),
};
