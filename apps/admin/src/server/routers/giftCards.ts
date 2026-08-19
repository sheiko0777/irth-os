import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { giftCards, giftCardTransactions, withAudit } from '@irth/db';
import { eq, and, desc, sql, ne } from 'drizzle-orm';
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
      // The card and its opening ledger line are one transaction: a card
      // issued without its `issue` row is a liability with no record of where
      // it came from, and the transaction history no longer reconciles to the
      // balance.
      const card = await ctx.withOrg(async (tx) => {
        const [issued] = await tx
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

        await tx.insert(giftCardTransactions).values({
          giftCardId: issued.id,
          orgId: ctx.orgId,
          amountMinor: initialAmountMinor,
          txType: 'issue',
          notes: 'بطاقة هدية جديدة',
        });

        return issued;
      });

      return { data: card, error: null };
    }),

  topup: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      amount: moneyInput,
      // Optional so existing callers are unaffected; a client opts in by
      // sending one. Only the CALLER can distinguish a retry from a second
      // genuine request — doing this twice in a minute is legitimate.
      idempotencyKey: z.string().min(1).max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('giftCards.topup', input.idempotencyKey, input, async () => {
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
    })),

  cancel: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [card] = await ctx.db
        .select()
        .from(giftCards)
        .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)));

      if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'البطاقة غير موجودة' });

      // The redeemed check is repeated in the UPDATE's WHERE rather than
      // trusted from the SELECT above. Between the two statements a concurrent
      // redemption can land, and cancelling a card that was just spent writes
      // off a balance the customer has already used.
      const updated = await ctx.withOrg(async (tx) => {
        const [row] = await tx
          .update(giftCards)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(and(
            eq(giftCards.id, input.id),
            eq(giftCards.orgId, ctx.orgId),
            ne(giftCards.status, 'redeemed'),
          ))
          .returning();

        if (!row) return null;

        await tx.insert(giftCardTransactions).values({
          giftCardId: input.id,
          orgId: ctx.orgId,
          amountMinor: BigInt(0),
          txType: 'cancel',
        });

        return row;
      });

      if (!updated) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'لا يمكن إلغاء بطاقة مستخدمة' });
      }

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
