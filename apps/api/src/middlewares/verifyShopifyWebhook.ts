import { MiddlewareHandler } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Shopify signs webhooks with HMAC-SHA256, base64-encoded, in the
 * `X-Shopify-Hmac-Sha256` header — a different scheme from `verifyHmac`
 * (sha512, hex) used by Bosta/Paymob elsewhere in this codebase, so this is
 * its own middleware rather than a parameter added to that one.
 *
 * The signing secret is the app's Client Secret (SHOPIFY_APP_CLIENT_SECRET) —
 * Shopify does not issue a separate webhook-only secret for this app shape.
 */
export function verifyShopifyWebhook(): MiddlewareHandler {
  return async (c, next) => {
    const secret = process.env.SHOPIFY_APP_CLIENT_SECRET;
    if (!secret) return c.json({ data: null, error: 'Webhook secret not configured', meta: null }, 500);

    const signature = c.req.header('X-Shopify-Hmac-Sha256');
    if (!signature) return c.json({ data: null, error: 'Missing signature', meta: null }, 401);

    const body = await c.req.text();
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('base64');

    // Lengths can legitimately differ (a forged header of different length),
    // and timingSafeEqual throws rather than returning false on a length
    // mismatch — so that case is rejected directly instead of reaching it.
    const sigBuf = Buffer.from(signature, 'base64');
    const expBuf = Buffer.from(expected, 'base64');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return c.json({ data: null, error: 'Invalid signature', meta: null }, 401);
    }

    // Re-attach body for downstream handlers, matching verifyHmac's convention.
    c.set('rawBody', body);
    await next();
  };
}
