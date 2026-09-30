import { createAuthClient } from "better-auth/react";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { resolveAppBaseUrl } from "./appUrl";

// Mirrors the DEFAULT_LOCALE convention in
// src/app/api/join/resend-otp/route.ts: this file runs at module scope,
// outside any request, so it cannot read the visitor's actual locale from
// the URL. The 2FA challenge page itself is fully locale-aware (useLocale()
// picks the right strings and redirect target) — this only decides which
// URL segment Better Auth redirects an unauthenticated-but-challenged
// sign-in to.
const DEFAULT_LOCALE = "ar";

export const authClient = createAuthClient({
  baseURL: resolveAppBaseUrl(),
  plugins: [
    twoFactorClient({
      // When sign-in hits a 2FA challenge, route here instead of letting
      // the client think login failed.
      twoFactorPage: `/${DEFAULT_LOCALE}/two-factor`,
    }),
    usernameClient(),
  ],
});

export const { signIn, signOut, signUp, useSession } = authClient;
