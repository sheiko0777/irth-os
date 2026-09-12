/**
 * The one place `NEXT_PUBLIC_APP_URL` gets turned into a value safe to hand
 * to better-auth's `baseURL`.
 *
 * `auth-server.ts` and `auth-client.ts` both used to do
 * `process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'` — `??` only
 * falls back on `null`/`undefined`, not on an empty or blank string, so a
 * Vercel project with the var declared but blank (or containing stray
 * whitespace) passed `''` straight through. better-auth 1.6.11 tolerated
 * that; 1.7.4 does not — `betterAuth({...})` runs at module import time
 * (`auth-server.ts` is a top-level `export const auth = betterAuth(...)`,
 * imported at the top of `/api/auth/[...all]/route.ts`), and Next.js
 * imports every route module during `next build`'s "Collecting page data"
 * step to introspect it, long before any real request exists. That import
 * — not a live request — is what threw `TypeError: Invalid URL`, and it
 * broke `next build` itself: every push to `main` from the better-auth
 * 1.7.4 bump onward failed the Vercel deploy job before a single request
 * was ever served.
 *
 * `resolveAppBaseUrl()` fixes the actual gap: anything that is not a
 * parseable absolute URL — missing, blank, whitespace-only, or malformed —
 * falls back to the same `http://localhost:3000` default `??` intended,
 * instead of reaching `betterAuth()` unchecked.
 */
export function resolveAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return 'http://localhost:3000';
  try {
    // eslint-disable-next-line no-new -- validating, not constructing
    new URL(raw);
    return raw;
  } catch {
    console.error(
      `NEXT_PUBLIC_APP_URL is set but not a valid absolute URL (got: ${JSON.stringify(process.env.NEXT_PUBLIC_APP_URL)}); falling back to http://localhost:3000`,
    );
    return 'http://localhost:3000';
  }
}
