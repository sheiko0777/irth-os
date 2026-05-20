import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
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

  // Public routes mapping
  const isPublicRoute =
    pathWithoutLocale === "login" || pathWithoutLocale === "";

  // Check Better Auth Session
  // CVE-2025-29927 Mitigation: Validate Host Header properly or use API
  // Using Better Auth fetch to ensure correct host resolution securely
  let session = null;
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const sessionRes = await fetch(`${appUrl}/api/auth/get-session`, {
      headers: {
        cookie: request.headers.get("cookie") || "",
        "x-forwarded-host":
          request.headers.get("x-forwarded-host") ||
          request.headers.get("host") ||
          "",
      },
    });

    if (sessionRes.ok) {
      session = await sessionRes.json();
    }
  } catch (err) {
    console.error("Failed to fetch session in middleware", err);
  }

  const hasValidSession = session && session.session;

  if (!isPublicRoute && !hasValidSession) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Optional: Redirect authenticated users away from login
  if (pathWithoutLocale === "login" && hasValidSession) {
    const dashboardUrl = new URL(`/${locale}/dashboard`, request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
