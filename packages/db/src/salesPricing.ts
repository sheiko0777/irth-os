import { applyRate, assertSupportedCurrency, fromMinor } from '@irth/domain';

/**
 * What a sales rep charges (PR-2b), from a price list.
 *
 * Nothing applied price lists before this: they were stored and listed only.
 * The rule, per unit:
 *   1. an item on the list for this exact variant — that price;
 *   2. else an item for the variant's product (no variant) — that price;
 *   3. else the variant's own price (or its product's) less the list's
 *      discount, in basis points, rounded once to the piastre.
 *
 * Rounded per UNIT, on purpose: the unit price is the price a customer and
 * the tax authority see on each line (order_items.price_minor feeds the ETA
 * invoice lines), so the lines sum to the order total exactly by
 * construction. There is no header discount to split across lines.
 *
 * `listPriceMinor` is the price before the list, never below what is charged,
 * so an order's subtotal minus its discount is its total.
 */
export interface PriceListRule {
  id: string;
  currency: string;
  discountBp: number | null;
  startDate: Date | null;
  endDate: Date | null;
  items: ReadonlyArray<{ productId: string; variantId: string | null; priceMinor: bigint }>;
}

export interface PricedVariant {
  id: string;
  productId: string;
  /** Variant price, or null when it inherits its product's. */
  priceMinor: bigint | null;
  productPriceMinor: bigint;
}

export function isPriceListActive(list: Pick<PriceListRule, 'startDate' | 'endDate'>, at: Date): boolean {
  if (list.startDate && at < list.startDate) return false;
  if (list.endDate && at > list.endDate) return false;
  return true;
}

export function unitPrice(variant: PricedVariant, list: PriceListRule | null): { listPriceMinor: bigint; unitPriceMinor: bigint } {
  const base = variant.priceMinor ?? variant.productPriceMinor;
  if (!list) return { listPriceMinor: base, unitPriceMinor: base };
  const exact = list.items.find((i) => i.variantId === variant.id)
    ?? list.items.find((i) => i.variantId === null && i.productId === variant.productId);
  let unit: bigint;
  if (exact) {
    unit = exact.priceMinor;
  } else if (list.discountBp) {
    const c = assertSupportedCurrency(list.currency);
    unit = base - applyRate(fromMinor(base, c), list.discountBp).minor;
  } else {
    unit = base;
  }
  return { listPriceMinor: unit > base ? unit : base, unitPriceMinor: unit };
}

export interface PricedLine {
  variantId: string;
  quantity: number;
  listPriceMinor: bigint;
  unitPriceMinor: bigint;
}

/** Subtotal at list prices, what is charged, and the difference. */
export function totalsOf(lines: readonly PricedLine[]): { subtotalMinor: bigint; totalMinor: bigint; discountMinor: bigint } {
  let subtotalMinor = 0n;
  let totalMinor = 0n;
  for (const l of lines) {
    subtotalMinor += l.listPriceMinor * BigInt(l.quantity);
    totalMinor += l.unitPriceMinor * BigInt(l.quantity);
  }
  return { subtotalMinor, totalMinor, discountMinor: subtotalMinor - totalMinor };
}
