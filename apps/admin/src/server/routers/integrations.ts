import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { router, requirePermission } from '../trpc';
import { outboxEvents, SHOPIFY_API_VERSION, shopifyConnections, shopifyOAuthStates, withAudit } from '@irth/db';
import { desc, eq, and } from 'drizzle-orm';

const SHOPIFY_SCOPES = [
    'read_products', 'write_products', 'read_inventory', 'write_inventory',
    'read_orders', 'read_customers', 'read_pixels', 'write_pixels',
].join(',');

function normalizeShopDomain(value: string): string | null {
    const domain = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : null;
}

/**
 * The OAuth `connect` kickoff lives here — as a same-origin tRPC mutation on
 * app.irth-house.com — rather than as a browser redirect to apps/api's own
 * `/api/shopify/connect` route. That route requires an apps/api Better Auth
 * session (its own separate instance, per apps/api/src/middlewares/
 * authContext.ts), which the admin browser never has — the exact
 * cross-origin-cookie mismatch already documented and fixed for the invite
 * flow (see the comment on the `invite` mutation below in this same repo's
 * history, members.ts). Same fix here: reuse the request's own already-
 * verified admin session instead of a cross-service redirect.
 *
 * `/oauth/callback` stays on apps/api on purpose — Shopify calls that URL
 * directly (no browser session involved, HMAC-verified instead), so the
 * cross-origin concern doesn't apply there.
 */
export const integrationsRouter = router({
    outboxList: requirePermission('integrations', 'view')
        .input(z.object({ showProcessed: z.boolean().default(false) }))
        .query(async ({ ctx, input }) => {
            const baseCondition = eq(outboxEvents.orgId, ctx.orgId);
            const whereClause = input.showProcessed
                ? baseCondition
                : and(baseCondition, eq(outboxEvents.processed, false));

            const events = await ctx.db
                .select()
                .from(outboxEvents)
                .where(whereClause)
                .orderBy(desc(outboxEvents.createdAt))
                .limit(50);

            return { data: events, error: null, meta: null };
        }),

    outboxRetry: requirePermission('integrations', 'recover')
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const event = await ctx.withOrg((tx) => withAudit(
                tx,
                async () => {
                    const [retried] = await tx
                        .update(outboxEvents)
                        .set({
                            attempts: 0,
                            lastError: null,
                            nextRetryAt: null,
                            claimedAt: null,
                        })
                        .where(and(
                            eq(outboxEvents.id, input.id),
                            eq(outboxEvents.orgId, ctx.orgId),
                            eq(outboxEvents.processed, false),
                        ))
                        .returning();
                    if (!retried) {
                        throw new TRPCError({ code: 'NOT_FOUND', message: 'حدث الصندوق غير موجود' });
                    }
                    return retried;
                },
                {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    action: 'RETRY_OUTBOX_EVENT',
                    tableName: 'outbox_events',
                    changes: { id: input.id, triggeredBy: ctx.userId },
                },
            ));

            return { data: event, error: null, meta: null };
        }),

    shopifyStatus: requirePermission('integrations', 'view').query(async ({ ctx }) => {
        const [connection] = await ctx.db
            .select({
                shopDomain: shopifyConnections.shopDomain,
                status: shopifyConnections.status, pixelIngestionKey: shopifyConnections.pixelIngestionKey,
                inventoryLocationId: shopifyConnections.inventoryLocationId,
                lastSyncAt: shopifyConnections.lastSyncAt,
                lastWebhookAt: shopifyConnections.lastWebhookAt,
                lastError: shopifyConnections.lastError,
                installedAt: shopifyConnections.installedAt,
            })
            .from(shopifyConnections)
            .where(eq(shopifyConnections.orgId, ctx.orgId));

        return { data: connection ?? null, error: null, meta: null };
    }),

    shopifyConnect: requirePermission('integrations', 'connect')
        .input(z.object({ shopDomain: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            const shopDomain = normalizeShopDomain(input.shopDomain);
            if (!shopDomain) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'أدخل نطاق متجر Shopify بصيغة صحيحة (مثال: your-store.myshopify.com)' });
            }
            const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
            // Established convention for "the Workers API's base URL from
            // admin's side" — declared in .env.local already, just not wired
            // to anything yet before this.
            const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;
            if (!clientId || !apiBaseUrl) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'تكامل Shopify غير مُهيأ بعد على الخادم' });
            }

            const state = randomBytes(32).toString('base64url');
            const stateHash = createHash('sha256').update(state).digest('hex');

            await ctx.withOrg((tx) => tx.insert(shopifyOAuthStates).values({
                orgId: ctx.orgId,
                shopDomain,
                stateHash,
                expiresAt: new Date(Date.now() + 10 * 60_000),
            }));

            const callback = `${apiBaseUrl.replace(/\/$/, '')}/api/shopify/oauth/callback`;
            const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
            authorizeUrl.searchParams.set('client_id', clientId);
            authorizeUrl.searchParams.set('scope', SHOPIFY_SCOPES);
            authorizeUrl.searchParams.set('redirect_uri', callback);
            authorizeUrl.searchParams.set('state', state);

            return { data: { url: authorizeUrl.toString() }, error: null, meta: null };
        }),

    /**
     * Reads and decrypts the org's Shopify token directly here rather than
     * calling apps/api's own `/locations`/`/location` routes — those sit
     * behind apps/api's separate Better Auth session (same cross-origin-
     * cookie issue documented on `shopifyConnect` above), and admin already
     * has direct DB access to the same `shopify_connections` row via
     * `shopifyStatus`. `SHOPIFY_TOKEN_ENCRYPTION_KEY` must be set on this
     * app's own environment too (mirrors `SHOPIFY_APP_CLIENT_ID` above,
     * already duplicated between apps/api's Cloudflare secrets and this
     * app's Vercel env) — decryption happens wherever the ciphertext is read.
     */
    shopifyLocations: requirePermission('integrations', 'view').query(async ({ ctx }) => {
        const [connection] = await ctx.db
            .select({
                shopDomain: shopifyConnections.shopDomain,
                accessTokenCiphertext: shopifyConnections.accessTokenCiphertext,
                accessTokenIv: shopifyConnections.accessTokenIv,
            })
            .from(shopifyConnections)
            .where(eq(shopifyConnections.orgId, ctx.orgId));
        if (!connection) return { data: [], error: null, meta: null };

        const encoded = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
        if (!encoded) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'تشفير رمز Shopify غير مُهيأ على هذا الخادم' });
        }
        const rawKey = Buffer.from(encoded, 'base64');
        if (rawKey.length !== 32) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'مفتاح تشفير Shopify غير صالح' });
        }
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: Buffer.from(connection.accessTokenIv, 'base64') },
            key,
            Buffer.from(connection.accessTokenCiphertext, 'base64'),
        );
        const accessToken = Buffer.from(decrypted).toString('utf8');

        const response = await fetch(`https://${connection.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query: 'query { locations(first: 50) { nodes { id name } } }' }),
        });
        if (!response.ok) {
            throw new TRPCError({ code: 'BAD_GATEWAY', message: 'تعذّر جلب مواقع المخزون من Shopify' });
        }
        const body = await response.json() as { data?: { locations: { nodes: Array<{ id: string; name: string }> } } };
        return { data: body.data?.locations.nodes ?? [], error: null, meta: null };
    }),

    shopifySetLocation: requirePermission('integrations', 'manage')
        .input(z.object({ inventoryLocationId: z.string().startsWith('gid://shopify/Location/') }))
        .mutation(async ({ ctx, input }) => {
            const [connection] = await ctx.withOrg((tx) => tx
                .update(shopifyConnections)
                .set({ inventoryLocationId: input.inventoryLocationId, updatedAt: new Date() })
                .where(eq(shopifyConnections.orgId, ctx.orgId))
                .returning({ inventoryLocationId: shopifyConnections.inventoryLocationId }));
            if (!connection) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'لا يوجد اتصال Shopify لهذه المنظمة' });
            }
            return { data: connection, error: null, meta: null };
        }),

    shopifyPixelSnippet: requirePermission('integrations', 'view').query(async ({ ctx }) => {
        const [connection] = await ctx.withOrg(async (tx) => tx
            .select({
                shopDomain: shopifyConnections.shopDomain,
                pixelIngestionKey: shopifyConnections.pixelIngestionKey,
                status: shopifyConnections.status,
            })
            .from(shopifyConnections)
            .where(eq(shopifyConnections.orgId, ctx.orgId)));

        if (!connection) {
            return { data: null, error: null, meta: null };
        }

        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.irth-house.com';
        const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/api/shopify/pixel/${connection.pixelIngestionKey}`;

        const snippet = `// IRTH-OS Realtime Customer & Cart Analytics Pixel
// Shopify Admin -> Settings -> Customer Events -> Add custom pixel
analytics.subscribe("all_standard_events", (event) => {
  const payload = {
    eventId: event.id,
    eventName: event.name,
    occurredAt: event.timestamp,
    clientId: event.clientId,
    path: event.context?.window?.location?.pathname,
    referrerHost: event.context?.window?.location?.hostname,
    metadata: {
      data: event.data,
      context: {
        language: event.context?.language,
        userAgent: event.context?.navigator?.userAgent,
      },
    },
  };

  if (event.name === "product_viewed" || event.name === "product_added_to_cart") {
    const item = event.data?.productVariant;
    if (item) {
      payload.productId = item.product?.id;
      payload.variantId = item.id;
      payload.metadata.title = item.product?.title;
      payload.metadata.price = item.price?.amount;
      payload.metadata.currency = item.price?.currencyCode;
      payload.metadata.sku = item.sku;
    }
  } else if (event.name === "cart_viewed") {
    const cart = event.data?.cart;
    if (cart) {
      payload.metadata.totalPrice = cart.cost?.totalAmount?.amount;
      payload.metadata.currency = cart.cost?.totalAmount?.currencyCode;
      payload.metadata.linesCount = cart.lines?.length;
      payload.metadata.lines = cart.lines?.map((l) => ({
        title: l.merchandise?.product?.title,
        quantity: l.quantity,
        price: l.merchandise?.price?.amount,
      }));
    }
  } else if (event.name === "checkout_started" || event.name === "checkout_completed") {
    const chk = event.data?.checkout;
    if (chk) {
      payload.metadata.checkoutToken = chk.token;
      payload.metadata.totalPrice = chk.totalPrice?.amount;
      payload.metadata.currency = chk.totalPrice?.currencyCode;
      payload.metadata.email = chk.email;
      payload.metadata.phone = chk.phone;
      payload.metadata.lines = chk.lineItems?.map((l) => ({
        title: l.title,
        quantity: l.quantity,
        price: l.variant?.price?.amount,
      }));
    }
  }

  fetch("${endpoint}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  });
});`;

        return {
            data: {
                endpoint,
                pixelIngestionKey: connection.pixelIngestionKey,
                snippet,
            },
            error: null,
            meta: null,
        };
    }),
});
