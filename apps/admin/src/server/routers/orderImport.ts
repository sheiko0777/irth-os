import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { orderImportCandidates, productVariants, products, variantSourceLinks, withAudit, type DbTx } from '@irth/db';
import { router, requirePermission } from '../trpc';

/**
 * OR-07: the operator side of resolving a blocked import candidate's lines to
 * local variants. Every link is an explicit decision recorded here (and
 * audited); suggestMappings only proposes, it never writes. Nothing in this
 * file links by SKU on its own.
 */

// Only the line fields these ops need; the full CandidateOrder schema lives in
// @irth/domain and is enforced where the candidate is written (OR-05/06).
const CandidateLines = z.object({
  lines: z.array(z.object({
    source_line_id: z.string().min(1),
    title: z.string(),
    sku_snapshot: z.string().optional(),
    source_variant_id: z.string().optional(),
    source_product_id: z.string().optional(),
  })),
});
type CandidateLine = z.infer<typeof CandidateLines>['lines'][number];

/**
 * The link key for a line. A line with no provider variant (a Shopify custom
 * line, or one whose variant was deleted) has nothing stable to key on, so it
 * falls back to its own line id — a per-order link, distinct from any real
 * variant GID by the `line:` prefix.
 */
function linkKey(line: CandidateLine): string {
  return line.source_variant_id?.trim() || `line:${line.source_line_id}`;
}

async function loadCandidate(tx: DbTx, orgId: string, candidateId: string) {
  const [candidate] = await tx.select({
    id: orderImportCandidates.id,
    connectionId: orderImportCandidates.connectionId,
    provider: orderImportCandidates.provider,
    normalized: orderImportCandidates.normalized,
  }).from(orderImportCandidates)
    .where(and(eq(orderImportCandidates.id, candidateId), eq(orderImportCandidates.orgId, orgId)));
  if (!candidate) throw new TRPCError({ code: 'NOT_FOUND', message: 'Import candidate not found' });
  if (!candidate.connectionId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Import candidate has no connection to link against' });
  }
  const parsed = CandidateLines.safeParse(candidate.normalized);
  if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Import candidate is not hydrated yet' });
  return { id: candidate.id, connectionId: candidate.connectionId, provider: candidate.provider, lines: parsed.data.lines };
}

async function loadLine(tx: DbTx, orgId: string, candidateId: string, sourceLineId: string) {
  const candidate = await loadCandidate(tx, orgId, candidateId);
  const line = candidate.lines.find((l) => l.source_line_id === sourceLineId);
  if (!line) throw new TRPCError({ code: 'NOT_FOUND', message: 'Line not found on this candidate' });
  return { candidate, line };
}

type LinkTarget =
  | { lineKind: 'mapped'; variantId: string }
  | { lineKind: 'custom_nonstock'; variantId: null };

/** Insert-or-repoint the link for one line. Org-guarded on the update path too. */
async function upsertLink(tx: DbTx, orgId: string, candidate: Awaited<ReturnType<typeof loadCandidate>>, line: CandidateLine, target: LinkTarget) {
  const values = {
    variantId: target.variantId,
    lineKind: target.lineKind,
    state: 'active' as const,
    sourceProductId: line.source_product_id ?? null,
    skuSnapshot: line.sku_snapshot ?? null,
    titleSnapshot: line.title,
  };
  const [link] = await tx.insert(variantSourceLinks)
    .values({ orgId, connectionId: candidate.connectionId, provider: candidate.provider, sourceVariantId: linkKey(line), ...values })
    .onConflictDoUpdate({
      target: [variantSourceLinks.provider, variantSourceLinks.connectionId, variantSourceLinks.sourceVariantId],
      set: { ...values, updatedAt: sql`now()` },
      setWhere: eq(variantSourceLinks.orgId, orgId),
    })
    .returning();
  if (!link) throw new TRPCError({ code: 'CONFLICT', message: 'Source variant is linked by another organization' });
  return link;
}

// TODO(OR-07): each op must enqueue 'inbound.candidate.reprocess' {orgId, candidateId}.
// OutboxEventType in packages/db/src/outbox.ts does not include it and
// emitOutboxEvent only accepts that closed union; that file is owned by a
// parallel change, so the event is added there (plus the worker handler) and
// emitted here in a follow-up.

const LineInput = z.object({
  candidateId: z.string().uuid(),
  sourceLineId: z.string().min(1).max(200),
});

/** Escapes LIKE wildcards so a title is matched literally. */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const SUGGESTION_LIMIT = 5;

export const orderImportRouter = router({
  mapLine: requirePermission('orders', 'write')
    .input(LineInput.extend({ variantId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const { candidate, line } = await loadLine(tx, ctx.orgId, input.candidateId, input.sourceLineId);
        const [variant] = await tx.select({ id: productVariants.id }).from(productVariants)
          .where(and(eq(productVariants.id, input.variantId), eq(productVariants.orgId, ctx.orgId)));
        if (!variant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Variant not found' });
        return upsertLink(tx, ctx.orgId, candidate, line, { lineKind: 'mapped', variantId: variant.id });
      }, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        action: 'MAP_IMPORT_LINE',
        tableName: 'variant_source_links',
        changes: input,
      }));
      return { data: link, error: null, meta: null };
    }),

  classifyCustomLine: requirePermission('orders', 'write')
    .input(LineInput.extend({ reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const { candidate, line } = await loadLine(tx, ctx.orgId, input.candidateId, input.sourceLineId);
        return upsertLink(tx, ctx.orgId, candidate, line, { lineKind: 'custom_nonstock', variantId: null });
      }, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        action: 'CLASSIFY_IMPORT_LINE_CUSTOM',
        tableName: 'variant_source_links',
        changes: input,
        reason: input.reason,
      }));
      return { data: link, error: null, meta: null };
    }),

  /**
   * Read-only. For each line with no active link: local variants whose SKU
   * equals the line's SKU snapshot first, then variants whose product name
   * resembles the line title. A suggestion only — the operator still calls
   * mapLine.
   */
  suggestMappings: requirePermission('orders', 'write')
    .input(z.object({ candidateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const lines = await ctx.withOrg(async (tx) => {
        const candidate = await loadCandidate(tx, ctx.orgId, input.candidateId);
        const keys = candidate.lines.map(linkKey);
        const linked = keys.length === 0 ? [] : await tx.select({ key: variantSourceLinks.sourceVariantId })
          .from(variantSourceLinks)
          .where(and(
            eq(variantSourceLinks.orgId, ctx.orgId),
            eq(variantSourceLinks.provider, candidate.provider),
            eq(variantSourceLinks.connectionId, candidate.connectionId),
            inArray(variantSourceLinks.sourceVariantId, keys),
            ne(variantSourceLinks.state, 'deleted'),
          ));
        const linkedKeys = new Set(linked.map((l) => l.key));

        const variantCols = {
          variantId: productVariants.id, productId: products.id, sku: productVariants.sku,
          variantName: productVariants.name, productName: products.name,
        };
        const out = [];
        // ponytail: two queries per unmapped line; batch them if candidates grow past a few dozen lines.
        for (const line of candidate.lines) {
          if (linkedKeys.has(linkKey(line))) continue;
          const sku = line.sku_snapshot?.trim();
          const bySku = sku ? await tx.select(variantCols).from(productVariants)
            .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.orgId, ctx.orgId)))
            .where(and(eq(productVariants.orgId, ctx.orgId), eq(productVariants.sku, sku)))
            .limit(SUGGESTION_LIMIT) : [];
          const title = line.title.trim();
          const byTitle = title ? await tx.select(variantCols).from(productVariants)
            .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.orgId, ctx.orgId)))
            .where(and(
              eq(productVariants.orgId, ctx.orgId),
              or(ilike(products.name, `%${likeLiteral(title)}%`), sql`${title} ILIKE '%' || ${products.name} || '%'`),
            ))
            .limit(SUGGESTION_LIMIT) : [];
          const seen = new Set(bySku.map((v) => v.variantId));
          out.push({
            sourceLineId: line.source_line_id,
            sourceVariantId: line.source_variant_id ?? null,
            title: line.title,
            skuSnapshot: line.sku_snapshot ?? null,
            suggestions: [
              ...bySku.map((v) => ({ ...v, match: 'sku' as const })),
              ...byTitle.filter((v) => !seen.has(v.variantId)).map((v) => ({ ...v, match: 'title' as const })),
            ].slice(0, SUGGESTION_LIMIT),
          });
        }
        return out;
      });
      return { data: lines, error: null, meta: null };
    }),
});
