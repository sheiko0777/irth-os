import {
  CandidateOrderSchema,
  validateCandidate,
  type CandidateOrder,
  type ValidateCandidateContext,
} from '@irth/domain';
import { describe, expect, it } from 'vitest';
import { normalizeShopifyOrder } from '../services/shopifyOrderNormalize';
import type { ShopifyOrderGraph } from '../services/shopifyOrderHydrate';

const ORDER_ID = 'gid://shopify/Order/1001';
const LINE_ID = 'gid://shopify/LineItem/2001';
const VARIANT_ID = 'gid://shopify/ProductVariant/3001';
const PRODUCT_ID = 'gid://shopify/Product/4001';

const validationCtx: ValidateCandidateContext = {
  connectionDimensionsResolved: true,
  supportedCurrencies: ['EGP', 'EUR'],
};

describe('normalizeShopifyOrder', () => {
  it('normalizes a simple mapped order', () => {
    const candidate = normalize(baseOrder(), links([[VARIANT_ID, { variantId: 'local-variant-1', lineKind: 'mapped' }]]));

    expect(candidate.header.source_order_id).toBe(ORDER_ID);
    expect(candidate.context.source_url).toBe('https://unit-test-shop.myshopify.com/admin/orders/1001');
    expect(candidate.lines).toHaveLength(1);
    expect(candidate.lines[0]?.mapping).toEqual({ state: 'mapped', variant_id: 'local-variant-1' });
    expect(candidate.lines[0]?.unit_price_minor).toBe('10000');
    expect(candidate.lines[0]?.total_minor).toBe('20000');
    expect(CandidateOrderSchema.parse(candidate)).toEqual(candidate);
  });

  it('uses line discount allocations without producing a totals mismatch', () => {
    const candidate = normalize(baseOrder({
      subtotal: '180.00',
      discounts: '20.00',
      tax: '25.20',
      shipping: '0.00',
      total: '205.20',
      line: {
        quantity: 2,
        discountAllocations: [discountAllocation('20.00')],
        taxLines: [taxLine('VAT', 0.14, '25.20')],
      },
    }), links([[VARIANT_ID, { variantId: 'local-variant-1', lineKind: 'mapped' }]]));

    expect(candidate.lines[0]?.discount_minor).toBe('2000');
    expect(candidate.lines[0]?.total_minor).toBe('18000');
    expect(candidate.price.discounts).toBe('2000');
    const result = validateCandidate(candidate, {}, validationCtx);
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('totals_mismatch');
  });

  it('keeps presentment money beside shop money while using shop money functionally', () => {
    const candidate = normalize(baseOrder({
      currencyCode: 'EGP',
      presentmentCurrencyCode: 'EUR',
      presentment: {
        subtotal: '3.00',
        tax: '0.42',
        shipping: '0.30',
        total: '3.72',
      },
    }), links([[VARIANT_ID, { variantId: 'local-variant-1', lineKind: 'mapped' }]]));

    expect(candidate.currency).toEqual({ shop: 'EGP', presentment: 'EUR' });
    expect(candidate.header.total_price_set).toEqual({
      shop_money_minor: '24800',
      presentment_money_minor: '372',
    });
    expect(candidate.price.total).toBe('24800');
  });

  it('keeps a deleted-variant line as unmapped with its source snapshot', () => {
    const candidate = normalize(baseOrder({
      line: {
        variant: null,
        product: null,
        sku: 'DELETED-SKU',
        title: 'Deleted variant item',
      },
    }), links([]));

    expect(candidate.lines).toHaveLength(1);
    expect(candidate.lines[0]?.mapping).toEqual({ state: 'unmapped' });
    expect(candidate.lines[0]?.title).toBe('Deleted variant item');
    expect(candidate.lines[0]?.sku_snapshot).toBe('DELETED-SKU');
    expect(candidate.lines[0]?.source_variant_id).toBeUndefined();
    expect(CandidateOrderSchema.parse(candidate)).toEqual(candidate);
  });

  it('classifies an explicitly linked custom line by line id', () => {
    const candidate = normalize(baseOrder({
      line: {
        variant: null,
        product: null,
        requiresShipping: false,
        taxable: false,
      },
    }), links([[`line:${LINE_ID}`, { variantId: null, lineKind: 'custom_nonstock' }]]));

    expect(candidate.lines[0]?.mapping).toEqual({ state: 'custom_nonstock' });
  });

  it('marks customer-null checkout as guest while retaining order contact fields', () => {
    const candidate = normalize(baseOrder({
      customer: null,
      email: 'guest@example.test',
      phone: '+201000000002',
    }), links([[VARIANT_ID, { variantId: 'local-variant-1', lineKind: 'mapped' }]]));

    expect(candidate.buyer).toMatchObject({
      email: 'guest@example.test',
      phone: '+201000000002',
      is_guest: true,
    });
  });

  it('detects cash on delivery from payment gateway names and transaction gateways', () => {
    const candidate = normalize(baseOrder({
      paymentGatewayNames: ['Cash on Delivery (COD)'],
      transactions: [transaction('gid://shopify/OrderTransaction/1', 'SALE', 'PENDING', 'cod', '248.00')],
    }), links([[VARIANT_ID, { variantId: 'local-variant-1', lineKind: 'mapped' }]]));

    expect(candidate.context.custom_attributes.cod).toBe('true');
    expect(candidate.transactions[0]?.gateway).toBe('cod');
  });

  it('records refund transactions as negative amounts', () => {
    const candidate = normalize(baseOrder({
      refunds: [{
        id: 'gid://shopify/Refund/1',
        createdAt: '2026-09-17T10:05:00Z',
        totalRefundedSet: moneySet('25.00'),
        transactions: {
          edges: [{
            node: transaction('gid://shopify/OrderTransaction/refund-1', 'REFUND', 'SUCCESS', 'shopify_payments', '25.00'),
          }],
        },
      }],
      totalRefunded: '25.00',
      totalOutstanding: '223.00',
    }), links([[VARIANT_ID, { variantId: 'local-variant-1', lineKind: 'mapped' }]]));

    expect(candidate.refunds[0]?.total_refunded_minor).toBe('2500');
    expect(candidate.transactions[0]?.amount_minor).toBe('-2500');
  });
});

function normalize(graph: ShopifyOrderGraph, linkMap: Map<string, { variantId: string | null; lineKind: 'mapped' | 'custom_nonstock' }>): CandidateOrder {
  const candidate = normalizeShopifyOrder(graph, {
    shopDomain: 'unit-test-shop.myshopify.com',
    links: linkMap,
    evidence: {
      inboundDeliveryId: 'delivery-1',
      apiVersion: '2026-07',
      connectorVersion: 'shopify@or-06',
      fetchedAt: '2026-09-17T10:00:01Z',
    },
  });
  expect(CandidateOrderSchema.parse(candidate)).toEqual(candidate);
  return candidate;
}

function links(entries: Array<[string, { variantId: string | null; lineKind: 'mapped' | 'custom_nonstock' }]>): Map<string, { variantId: string | null; lineKind: 'mapped' | 'custom_nonstock' }> {
  return new Map(entries);
}

function baseOrder(overrides: {
  currencyCode?: string;
  presentmentCurrencyCode?: string;
  presentment?: { subtotal: string; tax: string; shipping: string; total: string };
  subtotal?: string;
  discounts?: string;
  tax?: string;
  shipping?: string;
  total?: string;
  totalRefunded?: string;
  totalOutstanding?: string;
  customer?: Record<string, unknown> | null;
  email?: string;
  phone?: string;
  paymentGatewayNames?: string[];
  transactions?: Record<string, unknown>[];
  refunds?: Record<string, unknown>[];
  line?: Partial<Record<string, unknown>>;
} = {}): ShopifyOrderGraph {
  const subtotal = overrides.subtotal ?? '200.00';
  const tax = overrides.tax ?? '28.00';
  const shipping = overrides.shipping ?? '20.00';
  const total = overrides.total ?? '248.00';
  const presentment = overrides.presentment;
  const line = lineItem(overrides.line);
  return {
    id: ORDER_ID,
    legacyResourceId: '1001',
    name: '#1001',
    email: overrides.email ?? 'buyer@example.test',
    phone: overrides.phone ?? '+201000000001',
    createdAt: '2026-09-17T09:55:00Z',
    updatedAt: '2026-09-17T10:00:00Z',
    processedAt: '2026-09-17T10:00:00Z',
    cancelledAt: null,
    closedAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    currencyCode: overrides.currencyCode ?? 'EGP',
    presentmentCurrencyCode: overrides.presentmentCurrencyCode ?? overrides.currencyCode ?? 'EGP',
    taxesIncluded: false,
    test: false,
    note: 'Synthetic order',
    tags: ['or-06'],
    sourceName: 'web',
    app: { name: 'Online Store' },
    customer: overrides.customer === undefined
      ? { id: 'gid://shopify/Customer/1', displayName: 'Test Buyer', email: 'buyer@example.test', phone: '+201000000001' }
      : overrides.customer,
    shippingAddress: { name: 'Test Buyer', address1: '1 Test Street', city: 'Cairo', countryCode: 'EG' },
    billingAddress: { name: 'Test Buyer', address1: '1 Test Street', city: 'Cairo', countryCode: 'EG' },
    customAttributes: [{ key: 'source', value: 'unit-test' }],
    paymentGatewayNames: overrides.paymentGatewayNames ?? [],
    subtotalPriceSet: moneySet(subtotal, presentment?.subtotal, overrides.presentmentCurrencyCode),
    totalTaxSet: moneySet(tax, presentment?.tax, overrides.presentmentCurrencyCode),
    totalShippingPriceSet: moneySet(shipping, presentment?.shipping, overrides.presentmentCurrencyCode),
    totalPriceSet: moneySet(total, presentment?.total, overrides.presentmentCurrencyCode),
    totalDiscountsSet: moneySet(overrides.discounts ?? '0.00', '0.00', overrides.presentmentCurrencyCode),
    totalRefundedSet: moneySet(overrides.totalRefunded ?? '0.00'),
    totalOutstandingSet: moneySet(overrides.totalOutstanding ?? '0.00'),
    taxLines: [taxLine('VAT', 0.14, tax)],
    discountCodes: [],
    transactions: overrides.transactions ?? [],
    refunds: overrides.refunds ?? [],
    fulfillments: [],
    lineItems: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [{ cursor: 'cursor-1', node: line }],
    },
  };
}

function lineItem(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const discountAllocations = (overrides.discountAllocations as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: LINE_ID,
    title: 'Test serum',
    variantTitle: '30ml',
    sku: 'SERUM-30',
    quantity: overrides.quantity ?? 2,
    currentQuantity: overrides.currentQuantity ?? overrides.quantity ?? 2,
    unfulfilledQuantity: overrides.unfulfilledQuantity ?? overrides.quantity ?? 2,
    refundableQuantity: overrides.refundableQuantity ?? overrides.quantity ?? 2,
    requiresShipping: overrides.requiresShipping ?? true,
    taxable: overrides.taxable ?? true,
    product: overrides.product === undefined ? { id: PRODUCT_ID } : overrides.product,
    variant: overrides.variant === undefined ? { id: VARIANT_ID, sku: 'SERUM-30' } : overrides.variant,
    originalUnitPriceSet: moneySet('100.00'),
    discountedTotalSet: moneySet('200.00'),
    taxLines: overrides.taxLines ?? [taxLine('VAT', 0.14, '28.00')],
    discountAllocations,
    customAttributes: [{ key: 'engraving', value: 'none' }],
    ...overrides,
  };
}

function transaction(id: string, kind: string, status: string, gateway: string, amount: string): Record<string, unknown> {
  return {
    id,
    kind,
    status,
    gateway,
    processedAt: '2026-09-17T10:02:00Z',
    amountSet: moneySet(amount),
  };
}

function discountAllocation(amount: string): Record<string, unknown> {
  return {
    allocatedAmountSet: moneySet(amount),
    discountApplication: { id: 'discount-1', title: 'Launch discount' },
  };
}

function taxLine(title: string, rate: number, amount: string): Record<string, unknown> {
  return {
    title,
    rate,
    ratePercentage: rate * 100,
    priceSet: moneySet(amount),
  };
}

function moneySet(amount: string, presentmentAmount = amount, presentmentCurrency = 'EGP'): Record<string, unknown> {
  return {
    shopMoney: { amount, currencyCode: 'EGP' },
    presentmentMoney: { amount: presentmentAmount, currencyCode: presentmentCurrency },
  };
}
