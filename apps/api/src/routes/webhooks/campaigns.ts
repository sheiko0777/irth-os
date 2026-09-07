import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { customers } from '@irth/db';
import { getDb } from '../../db';
import { envVar } from '../../utils/env';

export const campaignsWebhookRoute = new Hono();

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * No fallback secret. An unsubscribe token gates a real write (flipping
 * marketingConsent for an arbitrary customerId supplied in the query
 * string) — silently signing with a hardcoded, source-visible string if the
 * real secret is unset would make every customer's token forgeable.
 */
function unsubscribeSecret(): string {
    // Same required-in-production secret apps/api/src/auth.ts already reads
    // for session signing — no separate SESSION_SECRET exists in this repo.
    const secret = envVar('BETTER_AUTH_SECRET');
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not configured — cannot sign unsubscribe tokens');
    return secret;
}

export async function generateUnsubscribeToken(customerId: string): Promise<string> {
    const keyData = encoder.encode(unsubscribeSecret());
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const messageData = encoder.encode(customerId);
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return toHex(signatureBuffer);
}

campaignsWebhookRoute.get('/unsubscribe', async (c) => {
    const customerId = c.req.query('customerId');
    const token = c.req.query('token');

    if (!customerId || !token) {
        return c.text('Missing parameters', 400);
    }

    const expectedToken = await generateUnsubscribeToken(customerId);

    // Constant-time — matches the timingSafeEqual pattern this repo already
    // uses for every other signed-token comparison (verifyShopifyWebhook.ts,
    // paymob.ts, shopifyConnection.ts, etc.). Mismatched length is a
    // mismatch, not an error.
    const tokenBuf = Buffer.from(token, 'utf8');
    const expectedBuf = Buffer.from(expectedToken, 'utf8');
    if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
        return c.text('Invalid signature', 403);
    }

    const db = getDb();
    const [customer] = await db.update(customers)
        .set({ marketingConsent: false })
        .where(eq(customers.id, customerId))
        .returning();

    if (!customer) {
        return c.text('Customer not found', 404);
    }

    return c.text('You have been successfully unsubscribed from marketing messages.', 200);
});
