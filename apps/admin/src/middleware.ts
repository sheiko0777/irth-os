import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Apply next-intl middleware first
  const response = intlMiddleware(request);

  // Exclude static files, API, and images
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return response;
  }

  // Parse locale
  const segments = pathname.split("/");
  const locale = segments[1] || routing.defaultLocale;
  const pathWithoutLocale = segments.slice(2).join("/");

  // Public routes mapping. "join" must be here: it is the invite-acceptance
  // page, and by definition every visitor arriving on it has no session yet
  // — without this it always 307'd to /login before the JoinClient form
  // (and the token in the query string) ever rendered, silently breaking
  // the only onboarding path this app has (it is invite-only; there is no
  // open self-signup page).
  const isPublicRoute = pathWithoutLocale === "login" || pathWithoutLocale === "join" || pathWithoutLocale === "";

  // Optimistic session check — cookie presence only, no DB/network call.
  //
  // This used to call Better Auth's DB-backed getSession directly (throws in
  // the Edge runtime: "The edge runtime does not support Node.js 'net'
  // module", since the Postgres driver needs raw TCP) and, briefly, a
  // self-fetch to /api/auth/get-session (fragile: depends on
  // NEXT_PUBLIC_APP_URL being correct in every environment, and a middleware
  // calling back into its own deployment's API route is a known-flaky
  // pattern on Vercel's edge network) that silently degraded to "treat as
  // logged out" on any fetch failure, which would force-logout everyone in
  // production the moment that fetch broke for an unrelated reason.
  //
  // Middleware's job here is UX routing only (redirect a logged-out visitor
  // to /login, redirect a logged-in visitor away from /login) — it is not
  // the authorization boundary. The real, authoritative, DB-backed session
  // check already runs per-request in apps/admin/src/server/trpc.ts's
  // createContext() (verifySession(), CVE-2025-29927 mitigation) and in
  // every Better Auth API route — both execute in the Node.js runtime by
  // default (Next.js route handlers, unlike middleware, are not Edge-only),
  // so cross-tenant/authz enforcement is untouched by this file. A forged or
  // stale cookie only ever buys a visitor past this redirect, never past
  // createContext's real verification.
  const hasSessionCookie = Boolean(getSessionCookie(request));

  if (!isPublicRoute && !hasSessionCookie) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  // There used to be an "already authenticated, bounce away from /login"
  // redirect here, keyed on the same optimistic hasSessionCookie check
  // above. Removed: hasSessionCookie is cookie *presence*, not validity —
  // (dashboard)/page.tsx does the real DB-backed check and redirects an
  // invalid session INTO /login. Whenever a cookie is present but stale
  // (expired, revoked, or — what actually happened — pointed at a
  // DATABASE_URL that no longer has that session row after a DB migration),
  // the two redirects disagreed and looped forever (ERR_TOO_MANY_REDIRECTS,
  // 2026-09-22 incident). A genuinely-logged-in visitor who navigates to
  // /login now just sees the form instead of auto-bouncing to the
  // dashboard — a minor UX nicety traded for never looping.

  return response;
}

export const config = {
  // The matcher pattern is a JS string that Next.js compiles into a regex:
  // "\\." here is what produces a literal "\." in that regex (an escaped,
  // literal dot). A single "\." in the JS source is not a recognized escape
  // sequence, so JS silently drops the backslash, leaving "..*" — two
  // "any character" wildcards instead of "a literal dot" — which made the
  // negative lookahead reject ordinary paths like /en and /en/login, so
  // middleware (session-redirect, locale detection) silently never ran on
  // them; only the bare "/" happened to still match. Caught by CodeRabbit's
  // review of #219, verified independently with a plain node script before
  // fixing (see PR description).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
