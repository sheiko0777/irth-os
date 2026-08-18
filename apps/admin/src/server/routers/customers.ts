import { router, protectedProcedure, adminProcedure } from '../trpc';
import { z } from 'zod';
import { eq, and, desc, sql, count, ilike, or, gte } from 'drizzle-orm';
import { customers, loyaltyTransactions, withAudit } from '@irth/db';
import { TRPCError } from '@trpc/server';
import { EGP, parseDecimal } from '@irth/domain';

export const customersRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        pageSize: z.number().default(50),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;

      const whereClause = input.search
        ? and(
            eq(customers.orgId, ctx.orgId),
            or(
              ilike(customers.name, `%${input.search}%`),
              ilike(customers.email, `%${input.search}%`),
              ilike(customers.phone, `%${input.search}%`)
            )
          )
        : eq(customers.orgId, ctx.orgId);

      // Execute list and count queries concurrently to reduce latency
      const [data, totalRowResult] = await Promise.all([
        ctx.db
          .select()
          .from(customers)
          .where(whereClause)
          .orderBy(desc(customers.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        ctx.db
          .select({ count: count() })
          .from(customers)
          .where(whereClause)
      ]);

      const totalRow = totalRowResult[0];

      return {
        data,
        error: null,
        meta: { total: totalRow?.count ?? 0, page: input.page, pageSize: input.pageSize },
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const customer = await ctx.db.query.customers.findFirst({
        where: and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)),
      });

      if (!customer) throw new TRPCError({ code: 'NOT_FOUND' });

      const transactions = await ctx.db
        .select()
        .from(loyaltyTransactions)
        .where(eq(loyaltyTransactions.customerId, input.id))
        .orderBy(desc(loyaltyTransactions.createdAt))
        .limit(10);

      return { data: { ...customer, transactions }, error: null, meta: null };
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [customer] = await tx
            .insert(customers)
            .values({
              orgId: ctx.orgId,
              name: input.name,
              email: input.email || null,
              phone: input.phone,
              address: input.address,
              notes: input.notes,
            })
            .returning();
          return customer;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'CREATE_CUSTOMER',
          tableName: 'customers',
          changes: input,
        }
      ));
      return { data: result, error: null, meta: null };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      const customer = await ctx.db.query.customers.findFirst({
        where: and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)),
      });

      if (!customer) throw new TRPCError({ code: 'NOT_FOUND' });

      const mappedData = {
        ...updateData,
        email: updateData.email === '' ? null : updateData.email,
        updatedAt: new Date(),
      };

      const result = await ctx.withOrg((tx) => withAudit(
        tx,
        async () => {
          const [updated] = await tx
            .update(customers)
            .set(mappedData)
            .where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)))
            .returning();
          return updated;
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'UPDATE_CUSTOMER',
          tableName: 'customers',
          changes: updateData,
        }
      ));
      return { data: result, error: null, meta: null };
    }),

  addPoints: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        points: z.number().int().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Increment in SQL rather than read-then-write-absolute: two concurrent
      // grants both read the same starting balance and the second overwrites
      // the first, silently dropping points.
      const result = await ctx.withOrg(async (tx) => {
        const [updated] = await tx
          .update(customers)
          .set({
            loyaltyPoints: sql`${customers.loyaltyPoints} + ${input.points}`,
            updatedAt: new Date(),
          })
          .where(and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)))
          .returning();

        if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });

        await tx.insert(loyaltyTransactions).values({
          orgId: ctx.orgId,
          customerId: input.id,
          type: 'earn',
          points: input.points,
          balanceAfter: updated.loyaltyPoints,
          note: input.note,
        });

        return updated;
      });

      return { data: result, error: null, meta: null };
    }),

  redeemPoints: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        points: z.number().int().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.withOrg(async (tx) => {
        // The sufficient-balance check is part of the UPDATE's WHERE clause, so
        // check and decrement are one atomic step. Checking first and updating
        // after lets two concurrent redemptions both pass the check and spend
        // the same points twice, driving the balance negative.
        const [updated] = await tx
          .update(customers)
          .set({
            loyaltyPoints: sql`${customers.loyaltyPoints} - ${input.points}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(customers.id, input.id),
            eq(customers.orgId, ctx.orgId),
            gte(customers.loyaltyPoints, input.points),
          ))
          .returning();

        if (!updated) {
          // Either no such customer, or the balance was insufficient. Resolve
          // which, for an accurate error, now that no write can be lost.
          const existing = await tx.query.customers.findFirst({
            where: and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)),
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Insufficient loyalty points',
          });
        }

        await tx.insert(loyaltyTransactions).values({
          orgId: ctx.orgId,
          customerId: input.id,
          type: 'redeem',
          points: -input.points,
          balanceAfter: updated.loyaltyPoints,
          note: input.note,
        });

        return updated;
      });

      return { data: result, error: null, meta: null };
    }),

  linkOrder: adminProcedure
    .input(
      z.object({
        customerId: z.string().uuid(),
        orderId: z.string().uuid(),
        orderAmount: z.number().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const customer = await ctx.db.query.customers.findFirst({
        where: and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)),
      });

      if (!customer) throw new TRPCError({ code: 'NOT_FOUND' });

      const orderAmountMinor = parseDecimal(String(input.orderAmount), EGP).minor;
      const earnedPoints = parseInt((orderAmountMinor / parseDecimal('10', EGP).minor).toString(), 10);
      const newBalance = (customer.loyaltyPoints ?? 0) + earnedPoints;
      const newTotal = (customer.totalOrders ?? 0) + 1;

      const result = await ctx.withOrg(async (tx) => {
        const [updated] = await tx
          .update(customers)
          .set({
            loyaltyPoints: newBalance,
            totalOrders: newTotal,
            totalSpentMinor: sql`${customers.totalSpentMinor} + ${orderAmountMinor}`,
            updatedAt: new Date(),
          })
          .where(and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)))
          .returning();

        if (earnedPoints > 0) {
          await tx.insert(loyaltyTransactions).values({
            orgId: ctx.orgId,
            customerId: input.customerId,
            type: 'earn',
            points: earnedPoints,
            balanceAfter: newBalance,
            note: `طلب مرتبط`,
            referenceId: input.orderId,
          });
        }

        return updated;
      });

      return { data: result, error: null, meta: null };
    }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    const [totals] = await ctx.db
      .select({
        totalCustomers: count(),
        totalPoints: sql<number>`COALESCE(SUM(${customers.loyaltyPoints}), 0)::int`,
      })
      .from(customers)
      .where(eq(customers.orgId, ctx.orgId));

    return {
      data: {
        totalCustomers: totals?.totalCustomers ?? 0,
        totalLoyaltyPoints: totals?.totalPoints ?? 0,
      },
      error: null,
      meta: null,
    };
  }),
});

