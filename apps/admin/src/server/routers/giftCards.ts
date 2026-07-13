import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { giftCards, giftCardTransactions } from '@irth/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [4, 4, 4].map(() =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  );
  return segments.join('-');
}

export const giftCardsRouter = router({
  list: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(giftCards)
        .where(eq(giftCards.orgId, ctx.orgId))
        .orderBy(desc(giftCards.createdAt))
        .limit(200);
      return { data: rows, error: null };
    }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        status: giftCards.status,
        balance: giftCards.balance,
        initialAmount: giftCards.initialAmount,
      })
      .from(giftCards)
      .where(eq(giftCards.orgId, ctx.orgId));

    const total = rows.length;
    const active = rows.filter((r) => r.status === 'active').length;
    const totalIssued = rows.reduce((s, r) => s + parseFloat(r.initialAmount ?? '0'), 0);
    const activeBalance = rows
      .filter((r) => r.status === 'active')
      .reduce((s, r) => s + parseFloat(r.balance ?? '0'), 0);

    return { data: { total, active, totalIssued, activeBalance }, error: null };
  }),

  create: protectedProcedure
    .input(
      z.object({
        initialAmount: z.number().positive(),
        currency: z.string().default('EGP'),
        recipientName: z.string().optional(),
        recipientEmail: z.string().email().optional(),
        message: z.string().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const code = generateCode();
      const [card] = await ctx.db
        .insert(giftCards)
        .values({
          orgId: ctx.orgId,
          code,
          initialAmount: String(input.initialAmount),
          balance: String(input.initialAmount),
          currency: input.currency,
          status: 'active',
          recipientName: input.recipientName ?? null,
          recipientEmail: input.recipientEmail ?? null,
          message: input.message ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .returning();

      await ctx.db.insert(giftCardTransactions).values({
        giftCardId: card.id,
        orgId: ctx.orgId,
        amount: String(input.initialAmount),
        txType: 'issue',
        notes: 'بطاقة هدية جديدة',
      });

      return { data: card, error: null };
    }),

  topup: protectedProcedure
    .input(z.object({ id: z.string().uuid(), amount: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [card] = await ctx.db
        .select()
        .from(giftCards)
        .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)));

      if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'البطاقة غير موجودة' });
      if (card.status === 'cancelled') throw new TRPCError({ code: 'BAD_REQUEST', message: 'البطاقة ملغاة' });

      const newBalance = parseFloat(card.balance ?? '0') + input.amount;
      const [updated] = await ctx.db
        .update(giftCards)
        .set({ balance: String(newBalance), status: 'active', updatedAt: new Date() })
        .where(eq(giftCards.id, input.id))
        .returning();

      await ctx.db.insert(giftCardTransactions).values({
        giftCardId: input.id,
        orgId: ctx.orgId,
        amount: String(input.amount),
        txType: 'topup',
      });

      return { data: updated, error: null };
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [card] = await ctx.db
        .select()
        .from(giftCards)
        .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)));

      if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'البطاقة غير موجودة' });
      if (card.status === 'redeemed') throw new TRPCError({ code: 'BAD_REQUEST', message: 'لا يمكن إلغاء بطاقة مستخدمة' });

      const [updated] = await ctx.db
        .update(giftCards)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(giftCards.id, input.id))
        .returning();

      await ctx.db.insert(giftCardTransactions).values({
        giftCardId: input.id,
        orgId: ctx.orgId,
        amount: '0',
        txType: 'cancel',
      });

      return { data: updated, error: null };
    }),

  getTransactions: protectedProcedure
    .input(z.object({ giftCardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(giftCardTransactions)
        .where(
          and(
            eq(giftCardTransactions.giftCardId, input.giftCardId),
            eq(giftCardTransactions.orgId, ctx.orgId)
          )
        )
        .orderBy(desc(giftCardTransactions.createdAt));
      return { data: rows, error: null };
    }),
});
