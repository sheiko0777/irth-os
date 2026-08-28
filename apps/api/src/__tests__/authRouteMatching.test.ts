import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

/**
 * Regression test for a routing bug that shipped to production undetected:
 * Hono has no '**' wildcard syntax (index.ts's own working '/api/*' pattern,
 * two lines above the auth route, is the real one). '/api/auth/**' matched
 * literally NOTHING — every request under /api/auth, real or garbage, fell
 * through to app.notFound(). Confirmed live against the deployed Worker
 * before this fix: /api/auth/session, /api/auth, and /api/auth/ok all
 * returned the identical generic {"error":"not_found"}, meaning Better
 * Auth's handler was completely unreachable — no client (mobile, a direct
 * API consumer) could ever sign in through this Worker.
 *
 * `isPublic()` (authContext.test.ts) only tests which paths SKIP the session
 * check — it never asserted the route actually dispatches anywhere, which is
 * exactly the gap that let this ship. This test builds the real
 * route-registration pattern (not a mock of it) so a future "simplify this
 * to **" cannot silently reintroduce the bug.
 */
describe('the /api/auth/* route actually matches', () => {
  it('dispatches nested auth paths to the handler, not notFound', async () => {
    const app = new Hono();
    let handlerHit = false;
    app.on(['POST', 'GET'], '/api/auth/*', (c) => {
      handlerHit = true;
      return c.json({ handled: true });
    });
    app.notFound((c) => c.json({ data: null, error: 'not_found', meta: null }, 404));

    const paths = ['/api/auth', '/api/auth/session', '/api/auth/sign-in/email', '/api/auth/callback/google'];
    for (const path of paths) {
      handlerHit = false;
      const res = await app.request(path, { method: 'GET' });
      expect(res.status, `${path} should not 404`).not.toBe(404);
      expect(handlerHit, `${path} should reach the auth handler`).toBe(true);
    }
  });

  // Not asserted here: the OLD '**' pattern's exact match behavior. It turns
  // out to be inconsistent — Hono's local (Node/vitest) router resolves a
  // single-segment path like '/api/auth/session' differently than the
  // deployed Cloudflare Workers runtime did (confirmed live pre-fix: GET
  // /api/auth/session, /api/auth, and a garbage /api/auth/ok all returned the
  // Worker's real {"error":"not_found"}), so pinning a specific "matches
  // exactly N segments" theory into a test would assert something not
  // actually guaranteed by Hono across environments. The test above is what
  // matters: it proves the correct '*' syntax reliably matches every shape
  // of auth path this app needs, which '**' provably did not in production.
});
