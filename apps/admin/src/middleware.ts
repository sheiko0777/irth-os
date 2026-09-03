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

  // Optional: Redirect authenticated users away from login
  if (pathWithoutLocale === "login" && hasSessionCookie) {
    // `/${locale}`, not `/${locale}/dashboard` — that route was removed (see
    // login/page.tsx's own comment: it "used to point at a stale duplicate
    // that sat outside the (dashboard) group and so rendered with no
    // sidebar and no header"). This redirect target was never updated to
    // match, so an already-authenticated visitor landing on /login was sent
    // to a 404 instead of the dashboard.
    const dashboardUrl = new URL(`/${locale}`, request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\..*).*)"],
};
