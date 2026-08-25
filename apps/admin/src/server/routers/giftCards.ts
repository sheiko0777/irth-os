import { z } from 'zod';
import { protectedProcedure, router, adminProcedure, ownerProcedure } from '../trpc';
import { giftCards, giftCardTransactions, withAudit, postJournalEntry, ACCOUNT_CODES } from '@irth/db';
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

        // A gift card is a liability the moment it exists: money (or its
        // promise) has been received against a future obligation to deliver
        // goods. Posted only when the amount is nonzero — a zero-value card,
        // if one is ever created, is not a transaction to record.
        //
        // ASSUMPTION, stated rather than silently baked in: this treats the
        // card as SOLD for cash equal to its face value. Nothing in this
        // schema distinguishes a purchased card from a promotional/free one —
        // there is no payment-method or "amount actually paid" field on this
        // mutation — so a free issuance would currently post as if cash had
        // been received for it. When that distinction is needed, `create`
        // needs a field for it before this posting can be conditioned on it.
        if (initialAmountMinor > 0n) {
          await postJournalEntry(tx, {
            orgId: ctx.orgId,
            journalType: 'general',
            description: `Gift card issued — ${code}`,
            sourceTable: 'gift_cards',
            sourceId: issued.id,
            createdBy: ctx.userId,
            lines: [
              { accountCode: ACCOUNT_CODES.BANK, debitMinor: initialAmountMinor },
              { accountCode: ACCOUNT_CODES.GIFT_CARD_LIABILITY, creditMinor: initialAmountMinor },
            ],
          });
        }

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

      // The SELECT above stays because the amount cannot be parsed until the
      // card's own currency is known — but its `status` is deliberately NOT
      // trusted. The cancelled guard is re-asserted in the UPDATE's WHERE
      // below: between the two statements a concurrent cancel can land, and
      // this statement would otherwise credit a cancelled card and flip it
      // back to 'active', reviving a balance that was written off.
      const amountMinor = parseDecimal(String(input.amount), currency(card.currency)).minor;

      const updated = await ctx.withOrg(async (tx) => {
        const [row] = await tx
          .update(giftCards)
          .set({
            balanceMinor: sql`${giftCards.balanceMinor} + ${amountMinor}`,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(and(
            eq(giftCards.id, input.id),
            eq(giftCards.orgId, ctx.orgId),
            ne(giftCards.status, 'cancelled'),
          ))
          .returning();

        // Nothing matched, so the card was cancelled after the read above. Bail
        // before the ledger line — a topup transaction with no balance change
        // is exactly the drift the gift-card ledger has to reconcile against.
        if (!row) return null;

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

      // The card existed a moment ago and this router has no delete path, so
      // the only way the guard matches nothing is a concurrent cancel — the
      // same BAD_REQUEST the pre-read used to raise.
      if (!updated) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'البطاقة ملغاة' });
      }

      return { data: updated, error: null };
    })),

  // The missing mutation: gift_card_status already carried 'redeemed' and
  // gift_card_tx_type already carried 'redeem' (both from the schema this
  // table shipped with), but nothing ever transitioned a card into either —
  // a card could be issued, topped up and cancelled, never actually spent.
  redeem: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      amount: moneyInput,
      // The order this redemption paid for, if any — stored on the ledger-of-
      // usage row (giftCardTransactions.orderId) for traceability. Optional:
      // a card can be redeemed as a standalone credit with nothing else on
      // this schema recording which order it went toward.
      orderId: z.string().uuid().optional(),
      idempotencyKey: z.string().min(1).max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('giftCards.redeem', input.idempotencyKey, input, async () => {
      const [card] = await ctx.db
        .select()
        .from(giftCards)
        .where(and(eq(giftCards.id, input.id), eq(giftCards.orgId, ctx.orgId)));

      if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'البطاقة غير موجودة' });

      // The SELECT stays for the same reason topup's does: the amount cannot
      // be parsed until the card's own currency is known. Its `status` and
      // `balanceMinor` are NOT trusted from it — both are re-asserted in the
      // UPDATE's WHERE below, so a concurrent redemption or cancellation
      // cannot land between this read and the write.
      const amountMinor = parseDecimal(String(input.amount), currency(card.currency)).minor;
      if (amountMinor <= 0n) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'قيمة غير صالحة' });
      }

      const updated = await ctx.withOrg(async (tx) => {
        const [row] = await tx
          .update(giftCards)
          .set({
            balanceMinor: sql`${giftCards.balanceMinor} - ${amountMinor}`,
            // A card is 'redeemed' only once fully spent — the CHECK on
            // balance_minor >= 0 (0028) is what actually stops it going
            // negative; this predicate is what stops a PARTIAL redemption
            // from being accepted as if it were the full balance.
            status: sql`CASE WHEN ${giftCards.balanceMinor} - ${amountMinor} = 0 THEN 'redeemed' ELSE ${giftCards.status} END`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(giftCards.id, input.id),
            eq(giftCards.orgId, ctx.orgId),
            eq(giftCards.status, 'active'),
            sql`${giftCards.balanceMinor} >= ${amountMinor}`,
          ))
          .returning();

        // Nothing matched: either the card is not active (cancelled, expired,
        // already fully redeemed) or the balance will not cover this amount.
        // Bail before the ledger line — a redemption that did not actually
        // debit the card must not credit revenue for it.
        if (!row) return null;

        await tx.insert(giftCardTransactions).values({
          giftCardId: input.id,
          orgId: ctx.orgId,
          amountMinor,
          txType: 'redeem',
          orderId: input.orderId ?? null,
        });

        // The card was used to pay for goods/services: the deferred revenue
        // recognised at issuance becomes real revenue now.
        await postJournalEntry(tx, {
          orgId: ctx.orgId,
          journalType: 'general',
          description: `Gift card redeemed — ${card.code}`,
          sourceTable: 'gift_cards',
          sourceId: input.id,
          createdBy: ctx.userId,
          lines: [
            { accountCode: ACCOUNT_CODES.GIFT_CARD_LIABILITY, debitMinor: amountMinor },
            { accountCode: ACCOUNT_CODES.SALES_REVENUE, creditMinor: amountMinor },
          ],
        });

        await withAudit(
          tx,
          async () => ({ id: input.id }),
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'REDEEM_GIFT_CARD',
            tableName: 'gift_cards',
            changes: { giftCardId: input.id, amountMinor, orderId: input.orderId ?? null },
          }
        );

        return row;
      });

      if (!updated) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'رصيد غير كافٍ أو البطاقة غير نشطة' });
      }

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
