/**
 * Rule 4 gate: authorization is server-side (CLAUDE.md).
 *
 * `isPublic` decides which requests skip the session check. Every route it
 * returns `true` for is reachable with no credentials at all, so a widened
 * prefix here is an authentication bypass — and one that no page renders
 * differently, so nothing but a test will catch it.
 *
 * The case that matters most is prefix confusion: `/api/authorize` must not be
 * treated as public just because it starts with the same characters as
 * `/api/auth`. The implementation guards this by appending `/` before the
 * `startsWith` comparison; this test is what keeps that `+ '/'` from being
 * "simplified" away.
 */
import { describe, expect, it } from 'vitest';
import { isPublic } from '../middlewares/publicRoutes';

describe('isPublic', () => {
  it('exempts the auth and webhook routes that authenticate by other means', () => {
    for (const path of [
      '/api/auth',
      '/api/auth/sign-in',
      '/api/auth/callback/google',
      '/api/webhooks',
      '/api/webhooks/bosta',
      '/webhooks/paymob',
      '/health',
      '/api/shopify/pixel',
      '/api/shopify/pixel/abc123',
      '/api/shopify/oauth',
      '/api/shopify/oauth/callback',
    ]) {
      expect(isPublic(path), `${path} should be public`).toBe(true);
    }
  });

  it('requires a session for every org-scoped API route', () => {
    for (const path of [
      '/api/orders',
      '/api/orders/123',
      '/api/products',
      '/api/inventory/adjust',
    ]) {
      expect(isPublic(path), `${path} must NOT be public`).toBe(false);
    }
  });

  it('does not widen the Shopify OAuth/pixel exemption to the rest of /api/shopify', () => {
    // '/connect', '/status', '/locations' share the '/api/shopify' mount with
    // the public 'oauth' and 'pixel' sub-paths but need a real admin session
    // — a broadened prefix here would let anyone kick off/read a store's
    // Shopify connection with no credentials.
    for (const path of [
      '/api/shopify/connect',
      '/api/shopify/status',
      '/api/shopify/locations',
      '/api/shopify',
    ]) {
      expect(isPublic(path), `${path} must NOT be public`).toBe(false);
    }
  });

  it('does not treat a longer path as public just because it shares a prefix', () => {
    // '/api/authorize' starts with '/api/auth' as a *string* but is a different
    // route. Dropping the trailing-slash guard would make all of these public.
    for (const path of [
      '/api/authorize',
      '/api/authenticate',
      '/api/webhooksadmin',
      '/api/auth-admin',
    ]) {
      expect(isPublic(path), `${path} must NOT be public`).toBe(false);
    }
  });

  it('does not session-gate non-API paths', () => {
    // These are handled by their own auth (signature) or need none.
    expect(isPublic('/')).toBe(true);
    expect(isPublic('/health')).toBe(true);
  });
});
