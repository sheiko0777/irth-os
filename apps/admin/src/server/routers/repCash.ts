import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, isNull, lt, sql, sum } from 'drizzle-orm';
import {
  ACCOUNT_CODES, MAX_IDEMPOTENCY_KEY_LENGTH, orgMembers, postJournalEntry, repCashCollections, repCashHandovers, user, withAudit,
} from '@irth/db';
import { assertSupportedCurrency, parseDecimal } from '@irth/domain';
import { router, requirePermission } from '../trpc';

/**
 * عهدة المناديب (PR-2a): the office's side of rep cash. A rep's handover is
 * counted here (confirm → Dr 1010 cash / Cr 1060 custody, for what was
 * actually received), and a shortage is written off by its own, separately
 * permissioned entry (Dr 5030 / Cr 1060). Nothing is edited after it posts;
 * each step moves a handover forward, guarded in the UPDATE's WHERE.
 */

const amountInput = z.string().trim().max(20).regex(/^\d+(\.\d{1,2})?$/, 'اكتب المبلغ بالأرقام');
const keyInput = z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH);

export const repCashRouter = router({
  /** Per rep: cash collected and not handed over, and handovers awaiting a count. */
  summary: requirePermission('repCash', 'view')
    .query(async ({ ctx }) => {
      const data = await ctx.withOrg(async (tx) => {
        const holding = await tx.select({
          memberId: repCashCollections.memberId,
          currency: repCashCollections.currency,
          openMinor: sum(repCashCollections.amountMinor).mapWith((v: string | null) => BigInt(v ?? '0')),
        })
          .from(repCashCollections)
          .where(and(eq(repCashCollections.orgId, ctx.orgId), isNull(repCashCollections.handoverId)))
          .groupBy(repCashCollections.memberId, repCashCollections.currency);
        const reps = await tx.select({ memberId: orgMembers.id, name: user.name, username: user.username, status: orgMembers.status })
          .from(orgMembers)
          .leftJoin(user, eq(user.id, orgMembers.userId))
          .where(and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.principalKind, 'delivery_rep')));
        return { holding, reps };
      });
      return { data, error: null, meta: null };
    }),

  handovers: requirePermission('repCash', 'view')
    .input(z.object({ status: z.enum(['submitted', 'confirmed']).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withOrg((tx) => tx.select({
        handover: repCashHandovers,
        repName: user.name,
        repUsername: user.username,
      })
        .from(repCashHandovers)
        .innerJoin(orgMembers, and(eq(orgMembers.id, repCashHandovers.memberId), eq(orgMembers.orgId, ctx.orgId)))
        .leftJoin(user, eq(user.id, orgMembers.userId))
        .where(and(
          eq(repCashHandovers.orgId, ctx.orgId),
          input.status ? eq(repCashHandovers.status, input.status) : undefined,
        ))
        .orderBy(desc(repCashHandovers.submittedAt))
        .limit(100));
      return { data: rows, error: null, meta: null };
    }),

  /** The cashier counted the cash: post what was received, never more than was collected. */
  confirm: requirePermission('repCash', 'confirm')
    .input(z.object({ handoverId: z.string().uuid(), received: amountInput, idempotencyKey: keyInput }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('repCash.confirm', input.idempotencyKey, input, async () => {
        const result = await ctx.withOrg(async (tx) => {
          const [current] = await tx.select({ currency: repCashHandovers.currency })
            .from(repCashHandovers)
            .where(and(eq(repCashHandovers.id, input.handoverId), eq(repCashHandovers.orgId, ctx.orgId)));
          if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
          const handoverCurrency = assertSupportedCurrency(current.currency);
          const receivedMinor = parseDecimal(input.received, handoverCurrency).minor;

          return withAudit(tx, async () => {
            // Both guards in the WHERE: still awaiting a count, and not more
            // than the rep collected (the table's CHECK holds the same line).
            const [row] = await tx.update(repCashHandovers)
              .set({ status: 'confirmed', receivedMinor, confirmedBy: ctx.userId, confirmedAt: sql`now()` })
              .where(and(
                eq(repCashHandovers.id, input.handoverId),
                eq(repCashHandovers.orgId, ctx.orgId),
                eq(repCashHandovers.status, 'submitted'),
                sql`${repCashHandovers.expectedMinor} >= ${receivedMinor}`,
              ))
              .returning();
            if (!row) {
              throw new TRPCError({ code: 'CONFLICT', message: 'العهدة اتأكدت قبل كده، أو المبلغ أكبر من المحصّل.' });
            }
            if (receivedMinor > 0n) {
              await postJournalEntry(tx, {
                orgId: ctx.orgId,
                journalType: 'cash',
                description: 'استلام عهدة مندوب',
                sourceTable: 'rep_cash_handovers',
                sourceId: row.id,
                createdBy: ctx.userId,
                lines: [
                  { accountCode: ACCOUNT_CODES.CASH, currency: handoverCurrency, debitMinor: receivedMinor },
                  { accountCode: ACCOUNT_CODES.REP_CUSTODY, currency: handoverCurrency, creditMinor: receivedMinor },
                ],
              });
            }
            return { id: row.id };
          }, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            action: 'REP_CASH_HANDOVER_CONFIRMED',
            tableName: 'rep_cash_handovers',
            changes: { handoverId: input.handoverId, receivedMinor: receivedMinor.toString() },
          });
        });
        return { data: result, error: null, meta: null };
      })),

  /** Book a counted shortage as a loss — its own entry, its own permission. */
  writeOffShortage: requirePermission('repCash', 'writeOff')
    .input(z.object({ handoverId: z.string().uuid(), idempotencyKey: keyInput }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('repCash.writeOffShortage', input.idempotencyKey, input, async () => {
        const result = await ctx.withOrg((tx) => withAudit(tx, async () => {
          const [row] = await tx.update(repCashHandovers)
            .set({
              writtenOffMinor: sql`${repCashHandovers.expectedMinor} - ${repCashHandovers.receivedMinor}`,
              writtenOffBy: ctx.userId,
              writtenOffAt: sql`now()`,
            })
            .where(and(
              eq(repCashHandovers.id, input.handoverId),
              eq(repCashHandovers.orgId, ctx.orgId),
              eq(repCashHandovers.status, 'confirmed'),
              isNull(repCashHandovers.writtenOffMinor),
              lt(repCashHandovers.receivedMinor, repCashHandovers.expectedMinor),
            ))
            .returning();
          if (!row || row.writtenOffMinor === null) {
            throw new TRPCError({ code: 'CONFLICT', message: 'مفيش عجز يتسوّى في العهدة دي.' });
          }
          const handoverCurrency = assertSupportedCurrency(row.currency);
          await postJournalEntry(tx, {
            orgId: ctx.orgId,
            journalType: 'general',
            description: 'تسوية عجز عهدة مندوب',
            sourceTable: 'rep_cash_handovers',
            sourceId: row.id,
            createdBy: ctx.userId,
            lines: [
              { accountCode: ACCOUNT_CODES.REP_CUSTODY_SHORTAGE, currency: handoverCurrency, debitMinor: row.writtenOffMinor },
              { accountCode: ACCOUNT_CODES.REP_CUSTODY, currency: handoverCurrency, creditMinor: row.writtenOffMinor },
            ],
          });
          return { id: row.id };
        }, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          action: 'REP_CASH_SHORTAGE_WRITTEN_OFF',
          tableName: 'rep_cash_handovers',
          changes: { handoverId: input.handoverId },
        }));
        return { data: result, error: null, meta: null };
      })),
});
