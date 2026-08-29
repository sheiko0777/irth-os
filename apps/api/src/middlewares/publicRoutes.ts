/**
 * Which requests skip the session check.
 *
 * Deliberately a standalone module with **no imports**. It used to live in
 * `authContext.ts`, whose import graph reaches `../auth` — and that module calls
 * `betterAuth({ database: { provider, url } })`, which initializes a database
 * adapter at import time. Testing a pure string predicate therefore booted a
 * database connection and failed. Keeping this dependency-free means the rule-4
 * gate tests the rule, not the app's startup sequence.
 */

// Routes that authenticate by other means (Better Auth itself, signature-verified
// webhooks) or need no auth (health) are skipped. Everything else under /api/*
// must carry a valid session.
// '/api/shopify/pixel' specifically, NOT '/api/shopify' as a whole — the
// storefront pixel has no session to carry, but '/api/shopify/connect' etc.
// (the OAuth/status/location routes, same '/api/shopify' mount) still need a
// real admin session and must stay gated. The pixel's own access control is
// the unguessable ingestionKey in its path, checked inside the route itself.
export const PUBLIC_PREFIXES = ['/api/auth', '/api/webhooks', '/webhooks', '/health', '/api/shopify/pixel'];

export function isPublic(path: string): boolean {
  // Non-/api routes (health, webhooks, root) are not session-gated here.
  if (!path.startsWith('/api/')) return true;
  // The trailing '/' matters: without it '/api/authorize' would match the
  // '/api/auth' prefix and become publicly reachable.
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}
