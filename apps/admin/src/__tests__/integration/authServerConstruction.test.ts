/**
 * Regression guard for the 2FA production incident (#331 shipped, every
 * sign-in 500'd; emergency-reverted in #336; root cause fixed here by
 * adding twoFactor's missing relations() declaration).
 *
 * The unit suite mocks `@irth/db` entirely, so it cannot see this class of
 * bug at all: better-auth 1.7.4's drizzle-adapter validates the real schema
 * (including relations()) the first time `betterAuth()` actually
 * constructs — which, behind auth-server.ts's lazy Proxy, is the first
 * property access on `auth`, triggered here (as it is in production) by
 * routing an actual request through `auth.handler`. A schema/relations
 * mismatch throws synchronously at that point, before any password is even
 * compared — which is why a *wrong* password is enough to reproduce it: no
 * real account or credential is needed for this test to catch the defect.
 */
import { describe, expect, it } from 'vitest';

describe('auth-server — betterAuth construction', () => {
  it('POST /api/auth/sign-in/email never 500s — proves the drizzle-adapter schema (incl. relations) is valid', async () => {
    const { auth } = await import('@/lib/auth-server');

    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent-construction-check@example.com',
          password: 'wrong-password-does-not-matter',
        }),
      }),
    );

    // Bad credentials -> better-auth's own 401/422-shaped rejection.
    // A 500 here means construction itself failed (schema/relations
    // validation, or anything else thrown inside createAuth()) — exactly
    // the incident this test exists to catch before it ships again.
    expect(response.status).not.toBe(500);
  });
});
