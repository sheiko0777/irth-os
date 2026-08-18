import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { giftCards, giftCardTransactions, withAudit } from '@irth/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { currency, fromMinor, parseDecimal } from '@irth/domain';

const moneyInput = z.string().min(1).or(z.number().positive());

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
        balanceMinor: giftCards.balanceMinor,
        initialAmountMinor: giftCards.initialAmountMinor,
      })
      .from(giftCards)
      .where(eq(giftCards.orgId, ctx.orgId));

    const total = rows.length;
    const active = rows.filter((r) => r.status === 'active').length;
    const totalIssuedMinor = rows.reduce((s, r) => s + r.initialAmountMinor, BigInt(0));
    const activeBalanceMinor = rows
      .filter((r) => r.status === 'active')
      .reduce((s, r) => s + r.balanceMinor, BigInt(0));

    return {
      data: {
        total,
        active,
        totalIssued: fromMinor(totalIssuedMinor),
        activeBalance: fromMinor(activeBalanceMinor),
      },
      error: null,
    };
  }),

  create: adminProcedure
    .input(
      z.object({
        initialAmount: moneyInput,
        currency: z.string().default('EGP'),
        recipientName: z.string().optional(),
        recipientEmail: z.string().email().optional(),
        message: z.string().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const code = generateCode();
      const giftCardCurrency = currency(input.currency);
      const initialAmountMinor = parseDecimal(String(input.initialAmount), giftCardCurrency).minor;
      const [card] = await ctx.db
        .insert(giftCards)
        .values({
          orgId: ctx.orgId,
          code,
          initialAmountMinor,
          balanceMinor: initialAmountMinor,
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
        amountMinor: initialAmountMinor,
        txType: 'issue',
        notes: 'بطاقة هدية جديدة',
      });

      return { data: card, error: null };
    }),

  topup: adminProcedure
    .input(z.object({ id: z.string().uuid(), amount: moneyInput }))
    .mutation(async ({ ctx, input }) => {
      const [card] = await ctx.db
        .select()
        .from(giftCards)
        .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)));

      if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'البطاقة غير موجودة' });
      if (card.status === 'cancelled') throw new TRPCError({ code: 'BAD_REQUEST', message: 'البطاقة ملغاة' });

      const amountMinor = parseDecimal(String(input.amount), currency(card.currency)).minor;

      const updated = await ctx.withOrg(async (tx) => {
        const [row] = await tx
          .update(giftCards)
          .set({
            balanceMinor: sql`${giftCards.balanceMinor} + ${amountMinor}`,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)))
          .returning();

        await tx.insert(giftCardTransactions).values({
          giftCardId: input.id,
          orgId: ctx.orgId,
          amountMinor,
          txType: 'topup',
        });

        await withAudit(
          tx,
          async () => ({ id: input.id }),
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'TOPUP_GIFT_CARD',
            tableName: 'gift_cards',
            changes: { giftCardId: input.id, amountMinor },
          }
        );

        return row;
      });

      return { data: updated, error: null };
    }),

  cancel: ownerProcedure
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
        .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)))
        .returning();

      await ctx.db.insert(giftCardTransactions).values({
        giftCardId: input.id,
        orgId: ctx.orgId,
        amountMinor: BigInt(0),
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
