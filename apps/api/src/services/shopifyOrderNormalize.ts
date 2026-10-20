import {
  CandidateOrderSchema,
  decimalStringToMinor,
  type CandidateOrder,
} from '@irth/domain';
import type { ShopifyOrderGraph } from './shopifyOrderHydrate';

type Link = { variantId: string | null; lineKind: 'mapped' | 'custom_nonstock' };

export interface NormalizeShopifyOrderContext {
  shopDomain: string;
  links: Map<string, Link>;
  evidence: {
    inboundDeliveryId: string;
    apiVersion: string;
    connectorVersion: string;
    fetchedAt: string;
  };
}

type RecordValue = Record<string, unknown>;
type Money = { amount: string; currencyCode: string };
type MoneySet = { shopMoney: Money; presentmentMoney?: Money };

const COD_GATEWAY = /cash on delivery|\bcod\b/i;

export function normalizeShopifyOrder(
  graph: ShopifyOrderGraph,
  ctx: NormalizeShopifyOrderContext,
): CandidateOrder {
  const order = record(graph);
  const currencyCode = requiredString(order.currencyCode, 'currencyCode');
  const presentmentCurrencyCode = optionalString(order.presentmentCurrencyCode);
  const lineEdges = connectionNodes(order.lineItems);
  const lines = lineEdges.map((line) => normalizeLine(line, ctx.links));
  const transactions = [
    ...arrayRecords(order.transactions).map((transaction) => normalizeTransaction(transaction, false)),
    ...refundRecords(order.refunds).flatMap((refund) =>
      connectionNodes(refund.transactions).map((transaction) => normalizeTransaction(transaction, true)),
    ),
  ];
  const paymentGatewayNames = stringArray(order.paymentGatewayNames);
  const hasCod = paymentGatewayNames.some((gateway) => COD_GATEWAY.test(gateway))
    || transactions.some((transaction) => transaction.gateway && COD_GATEWAY.test(transaction.gateway));

  const candidate = {
    header: {
      source_order_id: requiredString(order.id, 'id'),
      source_order_number: optionalString(order.name),
      source_name: optionalString(order.sourceName),
      source_updated_at: requiredString(order.updatedAt, 'updatedAt'),
      source_created_at: optionalString(order.createdAt),
      processed_at: optionalString(order.processedAt),
      cancelled_at: optionalString(order.cancelledAt),
      closed_at: optionalString(order.closedAt),
      financial_status: optionalString(order.displayFinancialStatus),
      fulfillment_status: optionalString(order.displayFulfillmentStatus),
      currency_code: currencyCode,
      presentment_currency_code: presentmentCurrencyCode,
      subtotal_price_set: normalizeMoneySet(requiredMoneySet(order.subtotalPriceSet, 'subtotalPriceSet')),
      total_price_set: normalizeMoneySet(requiredMoneySet(order.totalPriceSet, 'totalPriceSet')),
      total_tax_set: normalizeMoneySet(requiredMoneySet(order.totalTaxSet, 'totalTaxSet')),
      total_discounts_set: normalizeMoneySet(requiredMoneySet(order.totalDiscountsSet, 'totalDiscountsSet')),
      total_shipping_set: normalizeMoneySet(requiredMoneySet(order.totalShippingPriceSet, 'totalShippingPriceSet')),
      total_refunded_set: normalizeMoneySet(requiredMoneySet(order.totalRefundedSet, 'totalRefundedSet')),
      total_outstanding_set: normalizeMoneySet(requiredMoneySet(order.totalOutstandingSet, 'totalOutstandingSet')),
    },
    lines,
    buyer: normalizeBuyer(order),
    addresses: {
      billing: normalizeAddress(order.billingAddress),
      shipping: normalizeAddress(order.shippingAddress),
    },
    price: {
      subtotal: moneySetMinor(requiredMoneySet(order.subtotalPriceSet, 'subtotalPriceSet')),
      discounts: moneySetMinor(requiredMoneySet(order.totalDiscountsSet, 'totalDiscountsSet')),
      discount_codes: normalizeDiscountCodes(order.discountCodes),
      tax_lines: arrayRecords(order.taxLines).map(normalizeTaxLine),
      shipping: moneySetMinor(requiredMoneySet(order.totalShippingPriceSet, 'totalShippingPriceSet')),
      additional_fees: additionalFeesMinor(order.additionalFees, currencyCode),
      total: moneySetMinor(requiredMoneySet(order.totalPriceSet, 'totalPriceSet')),
      refunded: moneySetMinor(requiredMoneySet(order.totalRefundedSet, 'totalRefundedSet')),
      outstanding: moneySetMinor(requiredMoneySet(order.totalOutstandingSet, 'totalOutstandingSet')),
      taxes_included: Boolean(order.taxesIncluded),
    },
    currency: {
      shop: currencyCode,
      presentment: presentmentCurrencyCode,
    },
    transactions,
    fulfillments: arrayRecords(order.fulfillments).map(normalizeFulfillment),
    refunds: refundRecords(order.refunds).map(normalizeRefund),
    context: {
      note: optionalString(order.note),
      tags: stringArray(order.tags),
      custom_attributes: {
        ...customAttributes(order.customAttributes),
        ...(hasCod ? { cod: 'true' } : {}),
      },
      risk: order.risk,
      source_name: optionalString(order.sourceName),
      app_name: optionalString(recordOrUndefined(order.app)?.name),
      is_test: Boolean(order.test),
      cancel_reason: optionalString(order.cancelReason),
      source_url: sourceUrl(ctx.shopDomain, order.legacyResourceId),
    },
    evidence: {
      inbound_delivery_id: ctx.evidence.inboundDeliveryId,
      api_version: ctx.evidence.apiVersion,
      connector_version: ctx.evidence.connectorVersion,
      fetched_at: ctx.evidence.fetchedAt,
    },
  };

  return CandidateOrderSchema.parse(candidate);
}

function normalizeLine(line: RecordValue, links: Map<string, Link>): CandidateOrder['lines'][number] {
  const quantity = requiredInt(line.quantity, 'line.quantity');
  const unitPrice = requiredMoneySet(line.originalUnitPriceSet, 'line.originalUnitPriceSet');
  const discountAllocations = arrayRecords(line.discountAllocations).map(normalizeDiscountAllocation);
  const discountMinor = sumMinor(discountAllocations.map((discount) => BigInt(discount.amount_minor)));
  const totalMinor = moneySetMinorBigInt(unitPrice) * BigInt(quantity) - discountMinor;
  const variant = recordOrUndefined(line.variant);
  const product = recordOrUndefined(line.product);
  const sourceLineId = requiredString(line.id, 'line.id');
  const sourceVariantId = optionalString(variant?.id);
  const link = links.get(sourceVariantId ?? `line:${sourceLineId}`);

  return {
    source_line_id: sourceLineId,
    title: requiredString(line.title, 'line.title'),
    variant_title: optionalString(line.variantTitle),
    sku_snapshot: optionalString(line.sku) ?? optionalString(variant?.sku),
    source_variant_id: sourceVariantId,
    source_product_id: optionalString(product?.id),
    quantity,
    current_quantity: optionalInt(line.currentQuantity) ?? quantity,
    unfulfilled_quantity: optionalInt(line.unfulfilledQuantity) ?? 0,
    refundable_quantity: optionalInt(line.refundableQuantity) ?? 0,
    unit_price_minor: moneySetMinor(unitPrice),
    discount_minor: discountMinor.toString(),
    tax_minor: sumMinor(arrayRecords(line.taxLines).map((taxLine) => moneySetMinorBigInt(requiredMoneySet(taxLine.priceSet, 'taxLine.priceSet')))).toString(),
    total_minor: totalMinor.toString(),
    requires_shipping: Boolean(line.requiresShipping),
    taxable: Boolean(line.taxable),
    custom_attributes: customAttributes(line.customAttributes),
    tax_lines: arrayRecords(line.taxLines).map(normalizeTaxLine),
    discount_allocations: discountAllocations,
    mapping: normalizeMapping(link),
  };
}

function normalizeMapping(link: Link | undefined): CandidateOrder['lines'][number]['mapping'] {
  if (link?.lineKind === 'custom_nonstock') return { state: 'custom_nonstock' };
  if (link?.variantId) return { state: 'mapped', variant_id: link.variantId };
  return { state: 'unmapped' };
}

function normalizeBuyer(order: RecordValue): CandidateOrder['buyer'] {
  const customer = recordOrUndefined(order.customer);
  return {
    source_customer_id: optionalString(customer?.id),
    name: optionalString(customer?.displayName),
    email: optionalString(customer?.email) ?? optionalString(order.email),
    phone: optionalString(customer?.phone) ?? optionalString(order.phone),
    is_guest: customer == null,
  };
}

function normalizeAddress(value: unknown): CandidateOrder['addresses']['shipping'] {
  const address = recordOrUndefined(value);
  if (!address) return undefined;
  return {
    name: optionalString(address.name),
    first_name: optionalString(address.firstName),
    last_name: optionalString(address.lastName),
    company: optionalString(address.company),
    phone: optionalString(address.phone),
    address1: optionalString(address.address1),
    address2: optionalString(address.address2),
    city: optionalString(address.city),
    province: optionalString(address.province),
    province_code: optionalString(address.provinceCode),
    country: optionalString(address.country),
    country_code: optionalString(address.countryCode),
    zip: optionalString(address.zip),
  };
}

function normalizeMoneySet(set: MoneySet): CandidateOrder['header']['subtotal_price_set'] {
  return {
    shop_money_minor: moneyMinor(set.shopMoney).toString(),
    presentment_money_minor: set.presentmentMoney ? moneyMinor(set.presentmentMoney).toString() : undefined,
  };
}

function normalizeTaxLine(taxLine: RecordValue): CandidateOrder['price']['tax_lines'][number] {
  return {
    title: optionalString(taxLine.title),
    rate_basis_points: taxBasisPoints(taxLine),
    price_minor: moneySetMinor(requiredMoneySet(taxLine.priceSet, 'taxLine.priceSet')),
  };
}

function normalizeDiscountAllocation(discount: RecordValue): CandidateOrder['lines'][number]['discount_allocations'][number] {
  const application = recordOrUndefined(discount.discountApplication);
  return {
    source_discount_id: optionalString(application?.id),
    title: optionalString(application?.title),
    amount_minor: moneySetMinor(requiredMoneySet(discount.allocatedAmountSet, 'discount.allocatedAmountSet')),
  };
}

function normalizeDiscountCodes(value: unknown): CandidateOrder['price']['discount_codes'] {
  return arrayRecords(value).map((discount) => ({
    code: requiredString(discount.code, 'discountCode.code'),
    amount_minor: optionalMoneySetMinor(discount.amountSet),
  }));
}

function normalizeTransaction(transaction: RecordValue, forceNegative: boolean): CandidateOrder['transactions'][number] {
  const amount = moneySetMinorBigInt(requiredMoneySet(transaction.amountSet, 'transaction.amountSet'));
  const kind = requiredString(transaction.kind, 'transaction.kind');
  const amountMinor = forceNegative || kind.toLowerCase() === 'refund'
    ? negativeMagnitude(amount)
    : amount;
  return {
    source_transaction_id: requiredString(transaction.id, 'transaction.id'),
    kind,
    status: requiredString(transaction.status, 'transaction.status'),
    gateway: optionalString(transaction.gateway),
    amount_minor: amountMinor.toString(),
    processed_at: optionalString(transaction.processedAt),
  };
}

function normalizeRefund(refund: RecordValue): CandidateOrder['refunds'][number] {
  return {
    source_refund_id: requiredString(refund.id, 'refund.id'),
    created_at: optionalString(refund.createdAt),
    total_refunded_minor: moneySetMinor(requiredMoneySet(refund.totalRefundedSet, 'refund.totalRefundedSet')),
  };
}

function normalizeFulfillment(fulfillment: RecordValue): CandidateOrder['fulfillments'][number] {
  const trackingInfo = arrayRecords(fulfillment.trackingInfo);
  return {
    source_fulfillment_id: requiredString(fulfillment.id, 'fulfillment.id'),
    status: optionalString(fulfillment.status),
    tracking_company: optionalString(trackingInfo[0]?.company),
    tracking_numbers: trackingInfo.map((tracking) => optionalString(tracking.number)).filter(isDefined),
    created_at: optionalString(fulfillment.createdAt),
  };
}

function customAttributes(value: unknown): Record<string, string> {
  return arrayRecords(value).reduce<Record<string, string>>((attributes, item) => {
    const key = optionalString(item.key);
    const attrValue = optionalString(item.value);
    if (key && attrValue !== undefined) attributes[key] = attrValue;
    return attributes;
  }, {});
}

function requiredMoneySet(value: unknown, field: string): MoneySet {
  const set = record(value, field);
  return {
    shopMoney: requiredMoney(set.shopMoney, `${field}.shopMoney`),
    presentmentMoney: set.presentmentMoney == null ? undefined : requiredMoney(set.presentmentMoney, `${field}.presentmentMoney`),
  };
}

function requiredMoney(value: unknown, field: string): Money {
  const money = record(value, field);
  return {
    amount: requiredString(money.amount, `${field}.amount`),
    currencyCode: requiredString(money.currencyCode, `${field}.currencyCode`),
  };
}

function moneySetMinor(set: MoneySet): string {
  return moneySetMinorBigInt(set).toString();
}

function optionalMoneySetMinor(value: unknown): string | undefined {
  return value == null ? undefined : moneySetMinor(requiredMoneySet(value, 'moneySet'));
}

function moneySetMinorBigInt(set: MoneySet): bigint {
  return moneyMinor(set.shopMoney);
}

function moneyMinor(money: Money): bigint {
  return decimalStringToMinor(money.amount, money.currencyCode);
}

function additionalFeesMinor(value: unknown, currencyCode: string): string {
  const fees = arrayRecords(value);
  if (fees.length === 0) return '0';
  return sumMinor(fees.map((fee) => {
    const set = fee.priceSet ?? fee.amountSet ?? fee.originalPriceSet;
    return set == null ? 0n : moneySetMinorBigInt(requiredMoneySet(set, 'additionalFee.priceSet'));
  })).toString();
}

function sourceUrl(shopDomain: string, legacyResourceId: unknown): string | undefined {
  const legacyId = optionalString(legacyResourceId);
  if (!legacyId) return undefined;
  const domain = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${domain}/admin/orders/${legacyId}`;
}

function refundRecords(value: unknown): RecordValue[] {
  return arrayRecords(value);
}

function connectionNodes(value: unknown): RecordValue[] {
  const connection = recordOrUndefined(value);
  if (!connection) return [];
  return arrayRecords(connection.edges).map((edge) => recordOrUndefined(edge.node)).filter(isDefined);
}

function arrayRecords(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(recordOrUndefined).filter(isDefined) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(optionalString).filter(isDefined) : [];
}

function record(value: unknown, field = 'value'): RecordValue {
  const found = recordOrUndefined(value);
  if (!found) throw new TypeError(`Expected ${field} to be an object`);
  return found;
}

function recordOrUndefined(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
}

function requiredString(value: unknown, field: string): string {
  const found = optionalString(value);
  if (found === undefined) throw new TypeError(`Expected ${field} to be a string`);
  return found;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function requiredInt(value: unknown, field: string): number {
  const found = optionalInt(value);
  if (found === undefined) throw new TypeError(`Expected ${field} to be an integer`);
  return found;
}

function optionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function sumMinor(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

function negativeMagnitude(value: bigint): bigint {
  return value > 0n ? -value : value;
}

function taxBasisPoints(taxLine: RecordValue): number | undefined {
  if (typeof taxLine.ratePercentage === 'number') return Math.round(taxLine.ratePercentage * 100);
  if (typeof taxLine.rate === 'number') return Math.round(taxLine.rate * 10_000);
  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
