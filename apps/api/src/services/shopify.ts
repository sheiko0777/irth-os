// Shopify Admin API client.
//
// AUTH: this app is a custom-distribution app created after Jan 1 2026, when
// Shopify stopped issuing static admin-created custom-app tokens for new
// apps. The only credential Dev Dashboard hands out for this app shape is a
// Client ID + Client Secret; there is no long-lived access token to paste in.
// (An "app automation token" also exists on the same settings page, but that
// authenticates `shopify app deploy` in CI — it does not work against the
// Admin API at all; confirmed by testing, not assumed.)
//
// So every call here goes through the OAuth client_credentials grant: trade
// the durable Client ID/Secret for a ~24h access token, cache it in module
// scope, and re-fetch a few minutes before it actually expires. The
// credentials never expire on their own — only the derived token does.
//
// A Worker isolate can be reused across requests, so this in-memory cache
// does help in practice, but never assume it survives — a cold isolate has
// nothing cached and pays the token round-trip on its first Shopify call.

interface CachedToken {
  accessToken: string;
  expiresAt: number; // ms since epoch
}

let cachedToken: CachedToken | null = null;

// Refresh this long before the real 24h expiry so a slow request never hands
// back a token that dies mid-flight.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function shopDomain(): string {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  if (!domain) throw new Error('SHOPIFY_SHOP_DOMAIN is not set');
  return domain;
}

async function fetchAccessToken(): Promise<CachedToken> {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET');
  }

  const response = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify token exchange failed: ${response.status} - ${body}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedToken.accessToken;
  }
  cachedToken = await fetchAccessToken();
  return cachedToken.accessToken;
}

// Pinned rather than "latest" so a Shopify API version bump can't silently
// change response shapes underneath these calls without a deliberate bump
// here first.
const API_VERSION = '2024-10';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify GraphQL request failed: ${response.status} - ${body}`);
  }

  const result = await response.json() as GraphQLResponse<T>;
  if (result.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${result.errors.map(e => e.message).join('; ')}`);
  }
  if (!result.data) {
    throw new Error('Shopify GraphQL response had no data');
  }
  return result.data;
}

export interface ShopifyProductInput {
  // Present when this is an update to a product already linked to Shopify;
  // omitted on first push, letting `productSet` create it.
  shopifyProductId?: string | null;
  title: string;
  descriptionHtml?: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  variants: Array<{
    shopifyVariantId?: string | null;
    sku: string;
    priceMinor: bigint;
    currency: string;
  }>;
}

function statusFromLocal(status: string): 'ACTIVE' | 'DRAFT' | 'ARCHIVED' {
  if (status === 'active') return 'ACTIVE';
  if (status === 'archived') return 'ARCHIVED';
  return 'DRAFT';
}

/** Minor units (piastres) to Shopify's decimal string price — never a float. */
function minorToDecimalString(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Creates or updates a product and its variants in one call via `productSet`
 * — Shopify's own recommended replacement for the separate/deprecated
 * productCreate + productVariantsBulkUpdate pair, and idempotent by design:
 * passing the same identifier twice updates rather than duplicates.
 *
 * Returns the Shopify product GID and each variant's GID, in the same order
 * the variants were passed in, so the caller can persist the mapping.
 */
export async function upsertShopifyProduct(input: ShopifyProductInput): Promise<{
  shopifyProductId: string;
  variants: Array<{ sku: string; shopifyVariantId: string }>;
}> {
  const query = `
    mutation ProductSet($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product {
          id
          variants(first: 100) {
            nodes { id sku }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    input: {
      id: input.shopifyProductId ?? undefined,
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      status: input.status,
      variants: input.variants.map(v => ({
        id: v.shopifyVariantId ?? undefined,
        sku: v.sku,
        price: minorToDecimalString(v.priceMinor),
      })),
    },
  };

  const data = await shopifyGraphQL<{
    productSet: {
      product: { id: string; variants: { nodes: Array<{ id: string; sku: string }> } } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, variables);

  if (data.productSet.userErrors.length) {
    throw new Error(`productSet failed: ${data.productSet.userErrors.map(e => e.message).join('; ')}`);
  }
  if (!data.productSet.product) {
    throw new Error('productSet returned no product');
  }

  return {
    shopifyProductId: data.productSet.product.id,
    variants: data.productSet.product.variants.nodes.map(v => ({ sku: v.sku, shopifyVariantId: v.id })),
  };
}

/**
 * Pushes an absolute on-hand quantity for one variant to Shopify's default
 * ("available") inventory state at the given location — matching what the
 * dashboard already tracks in `inventory_items.quantity` (a running total,
 * not a delta), so this is a set, not an adjustment.
 */
export async function setShopifyInventoryQuantity(
  shopifyInventoryItemId: string,
  shopifyLocationId: string,
  quantity: number,
): Promise<void> {
  const query = `
    mutation SetQty($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message }
      }
    }
  `;

  const variables = {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: [{
        inventoryItemId: shopifyInventoryItemId,
        locationId: shopifyLocationId,
        quantity,
      }],
    },
  };

  const data = await shopifyGraphQL<{
    inventorySetQuantities: { userErrors: Array<{ field: string[]; message: string }> };
  }>(query, variables);

  if (data.inventorySetQuantities.userErrors.length) {
    throw new Error(`inventorySetQuantities failed: ${data.inventorySetQuantities.userErrors.map(e => e.message).join('; ')}`);
  }
}

export interface ShopifyCustomerInput {
  shopifyCustomerId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export async function upsertShopifyCustomer(input: ShopifyCustomerInput): Promise<{ shopifyCustomerId: string }> {
  if (input.shopifyCustomerId) {
    const query = `
      mutation CustomerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `;
    const data = await shopifyGraphQL<{
      customerUpdate: { customer: { id: string } | null; userErrors: Array<{ field: string[]; message: string }> };
    }>(query, { input: { id: input.shopifyCustomerId, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone } });

    if (data.customerUpdate.userErrors.length) {
      throw new Error(`customerUpdate failed: ${data.customerUpdate.userErrors.map(e => e.message).join('; ')}`);
    }
    if (!data.customerUpdate.customer) throw new Error('customerUpdate returned no customer');
    return { shopifyCustomerId: data.customerUpdate.customer.id };
  }

  const query = `
    mutation CustomerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL<{
    customerCreate: { customer: { id: string } | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(query, { input: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone } });

  if (data.customerCreate.userErrors.length) {
    throw new Error(`customerCreate failed: ${data.customerCreate.userErrors.map(e => e.message).join('; ')}`);
  }
  if (!data.customerCreate.customer) throw new Error('customerCreate returned no customer');
  return { shopifyCustomerId: data.customerCreate.customer.id };
}

export { statusFromLocal, minorToDecimalString };
