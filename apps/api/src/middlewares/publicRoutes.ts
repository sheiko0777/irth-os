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
export const PUBLIC_PREFIXES = ['/api/auth', '/api/webhooks', '/webhooks', '/health'];

export function isPublic(path: string): boolean {
  // Non-/api routes (health, webhooks, root) are not session-gated here.
  if (!path.startsWith('/api/')) return true;
  // The trailing '/' matters: without it '/api/authorize' would match the
  // '/api/auth' prefix and become publicly reachable.
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}
