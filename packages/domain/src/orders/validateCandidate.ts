import { z } from 'zod';
import { type Blocker, type CandidateOrder, SECTIONS, type Sections } from './candidate';

export const FetchStatusSchema = z.object({
  identity: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  items: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  buyer: z.enum(['loaded', 'permission_denied', 'not_exposed_by_provider', 'fetch_failed']).default('loaded'),
  addresses: z.enum(['loaded', 'permission_denied', 'not_exposed_by_provider', 'fetch_failed']).default('loaded'),
  price: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  currency: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  payment: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  fulfillment: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  returns: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  context: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  evidence: z.enum(['loaded', 'fetch_failed']).default('loaded'),
  paginationComplete: z.boolean().default(true),
  sourceLineCount: z.number().int().nonnegative().optional(),
});
export type FetchStatus = z.input<typeof FetchStatusSchema>;

export interface ValidateCandidateContext {
  readonly connectionDimensionsResolved: boolean;
  readonly supportedCurrencies: readonly string[];
}

export interface ValidateCandidateResult {
  readonly sections: Sections;
  readonly blockers: Blocker[];
}

const nextAction = {
  hydrateFailed: 'orders.import.next.retryHydration',
  paginationIncomplete: 'orders.import.next.retryHydration',
  lineLost: 'orders.import.next.retryHydration',
  totalsMismatch: 'orders.import.next.reviewTotals',
  unsupportedCurrency: 'orders.import.next.configureCurrency',
  buyerUnavailable: 'orders.import.next.grantProtectedCustomerData',
  shippingAddressMissing: 'orders.import.next.addShippingAddress',
  lineUnmapped: 'orders.import.next.mapVariant',
  dimensionsUnresolved: 'orders.import.next.resolveConnectionDimensions',
} as const;

function baseSections(fetchedAt: string): Sections {
  return Object.fromEntries(
    SECTIONS.map((section) => [section, { status: 'loaded' as const, fetchedAt }]),
  ) as Sections;
}

function detail(value: unknown): string {
  return JSON.stringify(value);
}

function minor(value: string): bigint {
  return BigInt(value);
}

function addBlocker(blockers: Blocker[], blocker: Blocker): void {
  blockers.push(blocker);
}

export function validateCandidate(
  candidate: CandidateOrder,
  fetchStatusInput: FetchStatus,
  ctx: ValidateCandidateContext,
): ValidateCandidateResult {
  const fetchStatus = FetchStatusSchema.parse(fetchStatusInput);
  const sections = baseSections(candidate.evidence.fetched_at);
  const blockers: Blocker[] = [];

  for (const section of SECTIONS) {
    const status = fetchStatus[section];
    if (status === 'fetch_failed') {
      sections[section] = { status: 'fetch_failed', fetchedAt: candidate.evidence.fetched_at };
      addBlocker(blockers, {
        code: 'hydrate_failed',
        section,
        detail: `fetch_failed:${section}`,
        nextAction: nextAction.hydrateFailed,
      });
    }
  }

  if (!fetchStatus.paginationComplete) {
    addBlocker(blockers, {
      code: 'pagination_incomplete',
      section: 'items',
      detail: 'paginationComplete=false',
      nextAction: nextAction.paginationIncomplete,
    });
  }

  const sourceLineCount = fetchStatus.sourceLineCount ?? candidate.lines.length;
  const invalidLines = candidate.lines.filter((line) => line.quantity <= 0);
  if (sourceLineCount !== candidate.lines.length || invalidLines.length > 0) {
    addBlocker(blockers, {
      code: 'line_lost',
      section: 'items',
      detail: detail({
        sourceLineCount,
        normalizedLineCount: candidate.lines.length,
        invalidLineIds: invalidLines.map((line) => line.source_line_id),
      }),
      nextAction: nextAction.lineLost,
    });
  }

  const unsupportedCurrencies = [candidate.currency.shop, candidate.currency.presentment]
    .filter((currency): currency is string => Boolean(currency))
    .filter((currency) => !ctx.supportedCurrencies.includes(currency));
  if (unsupportedCurrencies.length > 0) {
    sections.currency = { status: 'loaded', fetchedAt: candidate.evidence.fetched_at };
    addBlocker(blockers, {
      code: 'unsupported_currency',
      section: 'currency',
      detail: detail({ unsupportedCurrencies }),
      nextAction: nextAction.unsupportedCurrency,
    });
  }

  // Two exact reconciliations, in minor units, following Shopify's money model:
  //   lines:  Σ (unit_price × quantity − line discount) = subtotal
  //           (subtotal is already net of every discount allocated to lines)
  //   header: subtotal + shipping + tax (only when prices exclude it) + fees = total
  // Line totals are never summed against `discounts`, so an allocated discount
  // cannot be subtracted twice.
  const lineSubtotal = candidate.lines.reduce(
    (sum, line) => sum + minor(line.unit_price_minor) * BigInt(line.quantity) - minor(line.discount_minor),
    0n,
  );
  const subtotal = minor(candidate.price.subtotal);
  const taxTotal = candidate.price.taxes_included
    ? 0n
    : candidate.price.tax_lines.reduce((sum, tax) => sum + minor(tax.price_minor), 0n);
  const calculatedTotal =
    subtotal + minor(candidate.price.shipping) + taxTotal + minor(candidate.price.additional_fees);
  const reportedTotal = minor(candidate.price.total);
  if (lineSubtotal !== subtotal || calculatedTotal !== reportedTotal) {
    addBlocker(blockers, {
      code: 'totals_mismatch',
      section: 'price',
      detail: detail({
        lineSubtotal: lineSubtotal.toString(),
        subtotal: subtotal.toString(),
        calculatedTotal: calculatedTotal.toString(),
        reportedTotal: reportedTotal.toString(),
      }),
      nextAction: nextAction.totalsMismatch,
    });
  }

  // Redaction wins over whatever ids the provider still returned: Shopify keeps
  // sending customer.id when protected customer data is not granted.
  const buyerHidden =
    fetchStatus.buyer === 'permission_denied' || fetchStatus.buyer === 'not_exposed_by_provider';
  const buyerEmpty = !candidate.buyer.email && !candidate.buyer.phone && !candidate.buyer.name;
  if (buyerHidden || buyerEmpty) {
    const status = fetchStatus.buyer === 'permission_denied' ? 'permission_denied' : 'not_exposed_by_provider';
    sections.buyer = { status, fetchedAt: candidate.evidence.fetched_at };
    addBlocker(blockers, {
      code: 'buyer_unavailable',
      section: 'buyer',
      detail: status,
      nextAction: nextAction.buyerUnavailable,
    });
  }

  const requiresShipping = candidate.lines.some((line) => line.requires_shipping);
  if (!requiresShipping) {
    sections.addresses = { status: 'not_applicable', fetchedAt: candidate.evidence.fetched_at };
  } else if (fetchStatus.addresses === 'permission_denied') {
    sections.addresses = { status: 'permission_denied', fetchedAt: candidate.evidence.fetched_at };
  } else if (!candidate.addresses.shipping) {
    addBlocker(blockers, {
      code: 'shipping_address_missing',
      section: 'addresses',
      detail: 'shipping_address_missing',
      nextAction: nextAction.shippingAddressMissing,
    });
  }

  for (const line of candidate.lines) {
    if (line.mapping.state === 'unmapped') {
      addBlocker(blockers, {
        code: 'line_unmapped',
        section: 'items',
        detail: detail({ sourceLineId: line.source_line_id, sourceVariantId: line.source_variant_id }),
        nextAction: nextAction.lineUnmapped,
      });
    }
  }

  if (!ctx.connectionDimensionsResolved) {
    addBlocker(blockers, {
      code: 'dimensions_unresolved',
      section: 'context',
      detail: 'connection_dimensions_unresolved',
      nextAction: nextAction.dimensionsUnresolved,
    });
  }

  return { sections, blockers };
}
