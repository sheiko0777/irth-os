import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, requirePermission } from '../trpc';
import { outboxEvents, shopifyConnections, shopifyOAuthStates } from '@irth/db';
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
    outboxList: protectedProcedure
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

    retryOutboxEvent: requirePermission('integrations', 'connect')
        .input(z.object({ eventId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const updated = await ctx.withOrg((tx) => tx
                .update(outboxEvents)
                .set({ attempts: 0, lastError: null })
                .where(and(
                    eq(outboxEvents.id, input.eventId),
                    eq(outboxEvents.orgId, ctx.orgId)
                ))
                .returning({ id: outboxEvents.id }));

            if (updated.length === 0) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'لم يتم العثور على حدث صندوق الإرسال' });
            }

            return { data: { eventId: updated[0].id }, error: null, meta: null };
        }),
    shopifyStatus: protectedProcedure.query(async ({ ctx }) => {
        const [connection] = await ctx.db
            .select({
                shopDomain: shopifyConnections.shopDomain,
                status: shopifyConnections.status,
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
});
