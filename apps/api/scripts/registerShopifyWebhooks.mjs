#!/usr/bin/env node
/**
 * One-time (and safely re-runnable) registration of this app's Shopify
 * webhook subscriptions via the Admin GraphQL API.
 *
 * Run manually — SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET /
 * SHOPIFY_SHOP_DOMAIN / WEBHOOK_BASE_URL must be set in the environment.
 * There is no CI step for this: it only needs to run once per endpoint URL,
 * and running it from CI on every deploy would mean re-registering (harmless
 * but noisy) or de-duplicating against Shopify's API on every push for no
 * reason.
 *
 * Idempotent: lists existing subscriptions first and skips any topic already
 * pointed at this exact callback URL, so re-running after adding a topic only
 * creates the new one.
 */

const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;
const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
const baseUrl = process.env.WEBHOOK_BASE_URL;

if (!clientId || !clientSecret || !shopDomain || !baseUrl) {
  console.error('Missing SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET / SHOPIFY_SHOP_DOMAIN / WEBHOOK_BASE_URL');
  process.exit(1);
}

const API_VERSION = '2024-10';

async function getAccessToken() {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} - ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function graphql(token, query, variables) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`graphql request failed: ${res.status} - ${await res.text()}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`graphql error: ${body.errors.map(e => e.message).join('; ')}`);
  return body.data;
}

// Route suffix must match the mount points in apps/api/src/routes/webhooks/shopify.ts.
const TOPICS = [
  { topic: 'ORDERS_CREATE', route: 'orders-create' },
  { topic: 'ORDERS_UPDATED', route: 'orders-updated' },
  { topic: 'ORDERS_CANCELLED', route: 'orders-cancelled' },
  { topic: 'CUSTOMERS_CREATE', route: 'customers-upsert' },
  { topic: 'CUSTOMERS_UPDATE', route: 'customers-upsert' },
  { topic: 'INVENTORY_LEVELS_UPDATE', route: 'inventory-levels-update' },
];

async function main() {
  const token = await getAccessToken();

  const existing = await graphql(token, `
    query {
      webhookSubscriptions(first: 50) {
        nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
      }
    }
  `);
  const existingUrls = new Set(
    existing.webhookSubscriptions.nodes
      .filter(n => n.endpoint.__typename === 'WebhookHttpEndpoint')
      .map(n => `${n.topic}::${n.endpoint.callbackUrl}`),
  );

  for (const { topic, route } of TOPICS) {
    const callbackUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/shopify/${route}`;
    if (existingUrls.has(`${topic}::${callbackUrl}`)) {
      console.log(`  skip     ${topic} -> ${callbackUrl} (already registered)`);
      continue;
    }

    const result = await graphql(token, `
      mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }
    `, {
      topic,
      webhookSubscription: { callbackUrl, format: 'JSON' },
    });

    if (result.webhookSubscriptionCreate.userErrors.length) {
      console.error(`  FAILED   ${topic}: ${result.webhookSubscriptionCreate.userErrors.map(e => e.message).join('; ')}`);
      continue;
    }
    console.log(`  created  ${topic} -> ${callbackUrl}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
