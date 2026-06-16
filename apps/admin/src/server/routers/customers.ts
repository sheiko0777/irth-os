import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { eq, and, desc, sql, count, ilike, or } from 'drizzle-orm';
import { customers, loyaltyTransactions, withAudit } from '@irth/db';
import { TRPCError } from '@trpc/server';

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

      const [data, totalResult] = await Promise.all([
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

      const totalRow = totalResult[0];

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

  create: protectedProcedure
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
      const result = await withAudit(
        ctx.db,
        async () => {
          const [customer] = await ctx.db
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
      );
      return { data: result, error: null, meta: null };
    }),

  update: protectedProcedure
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

      const result = await withAudit(
        ctx.db,
        async () => {
          const [updated] = await ctx.db
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
      );
      return { data: result, error: null, meta: null };
    }),

  addPoints: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        points: z.number().int().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const customer = await ctx.db.query.customers.findFirst({
        where: and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)),
      });

      if (!customer) throw new TRPCError({ code: 'NOT_FOUND' });

      const newBalance = (customer.loyaltyPoints ?? 0) + input.points;

      const result = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(customers)
          .set({ loyaltyPoints: newBalance, updatedAt: new Date() })
          .where(and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)))
          .returning();

        await tx.insert(loyaltyTransactions).values({
          orgId: ctx.orgId,
          customerId: input.id,
          type: 'earn',
          points: input.points,
          balanceAfter: newBalance,
          note: input.note,
        });

        return updated;
      });

      return { data: result, error: null, meta: null };
    }),

  redeemPoints: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        points: z.number().int().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const customer = await ctx.db.query.customers.findFirst({
        where: and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)),
      });

      if (!customer) throw new TRPCError({ code: 'NOT_FOUND' });

      const currentBalance = customer.loyaltyPoints ?? 0;
      if (currentBalance < input.points) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Insufficient loyalty points',
        });
      }

      const newBalance = currentBalance - input.points;

      const result = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(customers)
          .set({ loyaltyPoints: newBalance, updatedAt: new Date() })
          .where(and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)))
          .returning();

        await tx.insert(loyaltyTransactions).values({
          orgId: ctx.orgId,
          customerId: input.id,
          type: 'redeem',
          points: -input.points,
          balanceAfter: newBalance,
          note: input.note,
        });

        return updated;
      });

      return { data: result, error: null, meta: null };
    }),

  linkOrder: protectedProcedure
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

      // 1 point per 10 EGP, rounded down
      const earnedPoints = Math.floor(input.orderAmount / 10);
      const newBalance = (customer.loyaltyPoints ?? 0) + earnedPoints;
      const newTotal = (customer.totalOrders ?? 0) + 1;
      const newSpent = (parseFloat(customer.totalSpent ?? '0') + input.orderAmount).toFixed(2);

      const result = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(customers)
          .set({
            loyaltyPoints: newBalance,
            totalOrders: newTotal,
            totalSpent: newSpent,
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
