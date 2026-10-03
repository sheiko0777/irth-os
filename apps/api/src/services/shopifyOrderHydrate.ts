import { SECTIONS, type Section, type SectionStatus } from '@irth/domain';
import { SHOPIFY_API_VERSION } from '@irth/db';
import {
  shopifyGraphQLRaw,
  type ShopifyGraphQLError,
  type ShopifyGraphQLFetch,
  type ShopifyGraphQLRawResult,
} from './shopifyConnection';

// One source of truth for the Admin API version (bumped to 2026-07 in OR-04).
export const SHOPIFY_ORDER_HYDRATE_API_VERSION = SHOPIFY_API_VERSION;

export const ORDER_QUERY = `
  query HydrateOrder($id: ID!, $lineItemsAfter: String) {
    order(id: $id) {
      id
      legacyResourceId
      name
      email
      phone
      createdAt
      updatedAt
      processedAt
      cancelledAt
      closedAt
      cancelReason
      displayFinancialStatus
      displayFulfillmentStatus
      currencyCode
      presentmentCurrencyCode
      taxesIncluded
      test
      note
      tags
      sourceName
      app { name }
      totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalOutstandingSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      customer { id displayName email phone }
      shippingAddress {
        name firstName lastName company phone address1 address2 city province provinceCode country countryCode zip
      }
      billingAddress {
        name firstName lastName company phone address1 address2 city province provinceCode country countryCode zip
      }
      customAttributes { key value }
      discountApplications(first: 50) {
        edges { node { allocationMethod targetSelection targetType value { ... on MoneyV2 { amount currencyCode } ... on PricingPercentageValue { percentage } } } }
      }
      shippingLines(first: 10) {
        edges {
          node {
            id title code source phone
            originalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            discountedPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            taxLines { title rate ratePercentage priceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } }
          }
        }
      }
      lineItems(first: 250, after: $lineItemsAfter) {
        pageInfo { hasNextPage endCursor }
        edges {
          cursor
          node {
            id
            title
            variantTitle
            sku
            quantity
            currentQuantity
            unfulfilledQuantity
            refundableQuantity
            requiresShipping
            taxable
            vendor
            product { id }
            variant { id sku inventoryItem { id } }
            originalUnitPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            discountedUnitPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            discountedTotalSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            taxLines { title rate ratePercentage priceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } }
            discountAllocations {
              allocatedAmountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
              discountApplication { allocationMethod targetSelection targetType value { ... on MoneyV2 { amount currencyCode } ... on PricingPercentageValue { percentage } } }
            }
            customAttributes { key value }
          }
        }
      }
      transactions(first: 50) {
        id kind status gateway processedAt
        amountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        parentTransaction { id }
      }
      refunds {
        id createdAt note
        totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        refundLineItems(first: 100) {
          edges {
            node {
              id quantity restockType subtotalSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
              lineItem { id }
            }
          }
        }
        transactions(first: 50) {
          edges {
            node {
              id kind status gateway processedAt
              amountSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
              parentTransaction { id }
            }
          }
        }
      }
      fulfillments {
        id status createdAt updatedAt
        trackingInfo { company number url }
        fulfillmentLineItems(first: 100) {
          edges { node { id quantity lineItem { id } } }
        }
      }
      events(first: 50) {
        edges { node { id message createdAt } }
      }
      metafields(first: 50) {
        edges { node { id namespace key value type } }
      }
    }
  }
`;

type ShopifyConnectionInput = Parameters<typeof shopifyGraphQLRaw>[0];
type SectionFetch = Record<Section, SectionStatus>;
type GraphQLData = { order?: ShopifyOrderGraph | null };

export interface ShopifyOrderGraph {
  id: string;
  lineItems?: ShopifyConnection<unknown>;
  [key: string]: unknown;
}

export interface RawPage {
  variables: { id: string; lineItemsAfter: string | null };
  data?: GraphQLData;
  errors?: ShopifyGraphQLError[];
  extensions?: unknown;
  status: number;
}

export interface ShopifyOrderHydrateDeps {
  fetch?: ShopifyGraphQLFetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface ShopifyOrderHydrateResult {
  apiVersion: string;
  pages: RawPage[];
  order: ShopifyOrderGraph | null;
  sectionsFetch: SectionFetch;
  paginationComplete: boolean;
}

interface ShopifyConnection<TNode> {
  edges?: Array<{ cursor?: string | null; node?: TNode }>;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function hydrateShopifyOrder(
  connection: ShopifyConnectionInput,
  sourceOrderId: string,
  deps: ShopifyOrderHydrateDeps = {},
): Promise<ShopifyOrderHydrateResult> {
  const pages: RawPage[] = [];
  const sectionsFetch = loadedSections();
  let order: ShopifyOrderGraph | null = null;
  let cursor: string | null = null;
  let paginationComplete = true;

  // ponytail: 40 pages x 250 = 10,000 lines; a provider that keeps answering
  // hasNextPage past that is treated as incomplete, never looped forever.
  const MAX_PAGES = 40;
  for (;;) {
    if (pages.length >= MAX_PAGES) {
      sectionsFetch.items = 'fetch_failed';
      paginationComplete = false;
      break;
    }
    const variables = { id: sourceOrderId, lineItemsAfter: cursor };
    const page = await fetchPage(connection, variables, deps);
    pages.push(page);
    classifyPage(page, sectionsFetch);

    if (page.status >= 500 || page.status === 429 || isThrottled(page) || isTransportFailure(page)) {
      markFetchFailed(sectionsFetch, order ? ['items'] : SECTIONS);
      paginationComplete = false;
      break;
    }

    const pageOrder = page.data?.order ?? null;
    if (!pageOrder) {
      markFetchFailed(sectionsFetch, order ? ['items'] : SECTIONS);
      paginationComplete = false;
      break;
    }

    order = order ? mergeLineItems(order, pageOrder) : pageOrder;
    const pageInfo = pageOrder.lineItems?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor ?? null;
    if (!cursor) {
      sectionsFetch.items = 'fetch_failed';
      paginationComplete = false;
      break;
    }
  }

  return {
    apiVersion: SHOPIFY_ORDER_HYDRATE_API_VERSION,
    pages,
    order,
    sectionsFetch,
    paginationComplete,
  };
}

async function fetchPage(
  connection: ShopifyConnectionInput,
  variables: { id: string; lineItemsAfter: string | null },
  deps: ShopifyOrderHydrateDeps,
): Promise<RawPage> {
  const sleeper = deps.sleep ?? sleep;
  for (let retry = 0; retry <= 3; retry += 1) {
    const result = await rawRequest(connection, variables, deps.fetch);
    if (!isThrottled(result)) return toRawPage(variables, result);
    if (retry === 3) return toRawPage(variables, result);
    await sleeper(throttleWaitMs(result.extensions));
  }
  return { variables, status: 0 };
}

async function rawRequest(
  connection: ShopifyConnectionInput,
  variables: { id: string; lineItemsAfter: string | null },
  fetcher?: ShopifyGraphQLFetch,
): Promise<ShopifyGraphQLRawResult<GraphQLData>> {
  try {
    return await shopifyGraphQLRaw<GraphQLData>(connection, ORDER_QUERY, variables, {
      apiVersion: SHOPIFY_ORDER_HYDRATE_API_VERSION,
      fetch: fetcher,
    });
  } catch {
    return { status: 0 };
  }
}

function toRawPage(
  variables: { id: string; lineItemsAfter: string | null },
  result: ShopifyGraphQLRawResult<GraphQLData>,
): RawPage {
  return {
    variables,
    data: result.data,
    errors: result.errors,
    extensions: result.extensions,
    status: result.status,
  };
}

function classifyPage(page: RawPage, sectionsFetch: SectionFetch): void {
  if (page.status >= 500 || page.status === 429 || isThrottled(page) || isTransportFailure(page)) return;
  for (const error of page.errors ?? []) {
    const path = error.path?.map(String) ?? [];
    const message = error.message.toLowerCase();
    if (message.includes('not approved to access') && path.some((part) => protectedCustomerDataPaths.has(part))) {
      sectionsFetch.buyer = 'permission_denied';
      sectionsFetch.addresses = 'permission_denied';
      continue;
    }
    if (path.some((part) => optionalPaths.has(part))) {
      sectionsFetch.context = 'not_exposed_by_provider';
      continue;
    }
    for (const section of sectionsForPath(path)) sectionsFetch[section] = 'fetch_failed';
  }
}

function loadedSections(): SectionFetch {
  return Object.fromEntries(SECTIONS.map((section) => [section, 'loaded'])) as SectionFetch;
}

function markFetchFailed(sectionsFetch: SectionFetch, sections: readonly Section[]): void {
  for (const section of sections) sectionsFetch[section] = 'fetch_failed';
}

function mergeLineItems(base: ShopifyOrderGraph, next: ShopifyOrderGraph): ShopifyOrderGraph {
  const baseLineItems = base.lineItems ?? {};
  const nextLineItems = next.lineItems ?? {};
  return {
    ...base,
    lineItems: {
      ...baseLineItems,
      edges: [...(baseLineItems.edges ?? []), ...(nextLineItems.edges ?? [])],
      pageInfo: nextLineItems.pageInfo,
    },
  };
}

function isThrottled(result: Pick<RawPage, 'status' | 'errors'>): boolean {
  if (result.status === 429) return true;
  return (result.errors ?? []).some((error) => {
    const code = typeof error.extensions?.code === 'string' ? error.extensions.code.toUpperCase() : '';
    return code === 'THROTTLED' || error.message.toLowerCase().includes('throttled');
  });
}

function isTransportFailure(result: Pick<RawPage, 'status'>): boolean {
  return result.status === 0;
}

function throttleWaitMs(extensions: unknown): number {
  const throttleStatus = readThrottleStatus(extensions);
  if (!throttleStatus) return 1_000;
  const requestedCost = throttleStatus.requestedQueryCost ?? 1;
  const deficit = Math.max(1, requestedCost - throttleStatus.currentlyAvailable);
  if (throttleStatus.restoreRate <= 0) return 1_000;
  return Math.ceil((deficit / throttleStatus.restoreRate) * 1_000);
}

function readThrottleStatus(extensions: unknown):
  | { currentlyAvailable: number; restoreRate: number; requestedQueryCost?: number }
  | null {
  if (!isRecord(extensions)) return null;
  const cost = extensions.cost;
  if (!isRecord(cost)) return null;
  const throttleStatus = cost.throttleStatus;
  if (!isRecord(throttleStatus)) return null;
  const currentlyAvailable = throttleStatus.currentlyAvailable;
  const restoreRate = throttleStatus.restoreRate;
  const requestedQueryCost = cost.requestedQueryCost;
  if (typeof currentlyAvailable !== 'number' || typeof restoreRate !== 'number') return null;
  return {
    currentlyAvailable,
    restoreRate,
    requestedQueryCost: typeof requestedQueryCost === 'number' ? requestedQueryCost : undefined,
  };
}

function sectionsForPath(path: readonly string[]): Section[] {
  if (path.includes('lineItems')) return ['items'];
  if (path.includes('transactions')) return ['payment'];
  if (path.includes('fulfillments') || path.includes('fulfillmentLineItems')) return ['fulfillment'];
  if (path.includes('refunds') || path.includes('refundLineItems')) return ['returns'];
  if (path.includes('shippingLines') || path.includes('discountApplications')) return ['price'];
  if (path.includes('currencyCode') || path.includes('presentmentCurrencyCode')) return ['currency'];
  if (path.includes('customer') || path.includes('email') || path.includes('phone')) return ['buyer'];
  if (path.includes('shippingAddress') || path.includes('billingAddress')) return ['addresses'];
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const protectedCustomerDataPaths = new Set([
  'customer',
  'email',
  'phone',
  'shippingAddress',
  'billingAddress',
]);

const optionalPaths = new Set(['risk', 'risks', 'events', 'metafields']);
