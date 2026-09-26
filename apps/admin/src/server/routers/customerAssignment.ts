import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { customers, orgMembers, user, withAudit } from '@irth/db';
import { requirePermission } from '../trpc';

/**
 * Handing customers to a sales rep (PR-2b). Spread into the customers router:
 * `customers.salesReps` and `customers.assignSalesRep`. The rep then sees
 * those customers, and their orders, and nobody else's (0078).
 */
export const customerAssignmentProcedures = {
  /** Active sales reps, for the assign picker. */
  salesReps: requirePermission('customers', 'assign')
    .query(async ({ ctx }) => {
      const rows = await ctx.withOrg((tx) => tx
        .select({ memberId: orgMembers.id, name: user.name, username: user.username })
        .from(orgMembers)
        .leftJoin(user, eq(user.id, orgMembers.userId))
        .where(and(
          eq(orgMembers.orgId, ctx.orgId),
          eq(orgMembers.principalKind, 'sales_rep'),
          eq(orgMembers.status, 'active'),
        ))
        .orderBy(asc(user.name)));
      return { data: rows, error: null, meta: null };
    }),

  /** Assign (memberId) or release (null) up to 100 customers at once. */
  assignSalesRep: requirePermission('customers', 'assign')
    .input(z.object({
      customerIds: z.array(z.string().uuid()).min(1).max(100),
      memberId: z.string().uuid().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const customerIds = [...new Set(input.customerIds)];
      const result = await ctx.withOrg(async (tx) => {
        if (input.memberId) {
          // FOR SHARE: not suspended or re-kinded before this commits.
          const [rep] = await tx.select({ id: orgMembers.id }).from(orgMembers)
            .where(and(
              eq(orgMembers.id, input.memberId),
              eq(orgMembers.orgId, ctx.orgId),
              eq(orgMembers.principalKind, 'sales_rep'),
              eq(orgMembers.status, 'active'),
            ))
            .for('share');
          if (!rep) throw new TRPCError({ code: 'BAD_REQUEST', message: 'مندوب المبيعات غير موجود أو موقوف.' });
        }
        return withAudit(tx, async () => ({
          id: input.memberId ?? undefined,
          rows: await tx.update(customers)
            .set({ salesRepMemberId: input.memberId, updatedAt: sql`now()` })
            .where(and(eq(customers.orgId, ctx.orgId), inArray(customers.id, customerIds)))
            .returning({ id: customers.id }),
        }), {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: input.memberId ? 'ASSIGN_CUSTOMER_SALES_REP' : 'UNASSIGN_CUSTOMER_SALES_REP',
          tableName: 'customers',
          changes: { customerIds, memberId: input.memberId },
        });
      });
      return { data: { assigned: result.rows.map((r) => r.id) }, error: null, meta: null };
    }),
};
