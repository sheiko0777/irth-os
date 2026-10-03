import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { verifyShopifyWebhook } from '../middlewares/verifyShopifyWebhook';

const SECRET = 'test-shopify-client-secret';

function signBytes(body: Uint8Array, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

function sign(body: string, secret = SECRET): string {
  return signBytes(new TextEncoder().encode(body), secret);
}

function buildApp() {
  const app = new Hono();
  app.post('/webhook', verifyShopifyWebhook(), (c) => c.json({ data: { ok: true }, error: null, meta: null }));
  return app;
}

function buildInspectingApp() {
  const app = new Hono();
  app.post('/webhook', verifyShopifyWebhook(), (c) => {
    const getContextValue = c.get as (key: string) => unknown;
    const rawBytes = getContextValue('rawBytes') as Uint8Array;
    return c.json({
      data: { bytes: Array.from(rawBytes), rawBody: getContextValue('rawBody') },
      error: null,
      meta: null,
    });
  });
  return app;
}

describe('verifyShopifyWebhook', () => {
  const originalSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;

  beforeEach(() => {
    process.env.SHOPIFY_APP_CLIENT_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.SHOPIFY_APP_CLIENT_SECRET = originalSecret;
  });

  it('accepts a request signed with the correct secret', async () => {
    const body = JSON.stringify({ id: 12345, line_items: [] });
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
  });

  it('rejects a request signed with the wrong secret', async () => {
    const body = JSON.stringify({ id: 12345 });
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': sign(body, 'wrong-secret') },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request whose body was tampered with after signing', async () => {
    const signature = sign(JSON.stringify({ id: 12345 }));
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': signature },
      body: JSON.stringify({ id: 99999 }), // different body, same (now-stale) signature
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with no signature header at all', async () => {
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ id: 12345 }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a signature of different length rather than throwing', async () => {
    // timingSafeEqual throws on mismatched buffer lengths; the middleware
    // must catch that case itself rather than turning a forged short header
    // into an unhandled 500.
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': 'dG9vc2hvcnQ=' },
      body: JSON.stringify({ id: 12345 }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 500 rather than 401 when no secret is configured', async () => {
    delete process.env.SHOPIFY_APP_CLIENT_SECRET;
    const body = JSON.stringify({ id: 12345 });
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': sign(body) },
      body,
    });
    expect(res.status).toBe(500);
  });

  it('verifies HMAC over the exact bytes, including invalid UTF-8', async () => {
    const body = Uint8Array.from([0x7b, 0xff, 0x7d]);
    const res = await buildInspectingApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': signBytes(body) },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { bytes: number[]; rawBody: string } };
    expect(json.data.bytes).toEqual([0x7b, 0xff, 0x7d]);
    expect(json.data.rawBody).toBe('{�}');
  });

  it('rejects a signature computed over decoded replacement text instead of the raw bytes', async () => {
    const body = Uint8Array.from([0x7b, 0xff, 0x7d]);
    const decodedSignature = sign('{�}');
    const res = await buildApp().request('/webhook', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': decodedSignature },
      body,
    });

    expect(res.status).toBe(401);
  });
});
