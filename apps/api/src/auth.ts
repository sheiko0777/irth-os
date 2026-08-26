import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, getEnv } from './db';
import { envVar, nodeEnv } from './utils/env';
import * as authSchema from '@irth/db/src/schema/auth';

/**
 * The Worker's Better Auth instance. Must stay in step with
 * `apps/admin/src/lib/auth-server.ts` — both talk to the same database, so a
 * disagreement between them is a disagreement about where tenancy lives.
 *
 * WHAT THIS REPLACED, and why each part was wrong:
 *
 *   database: { provider: 'postgresql', url: process.env.DATABASE_URL! }
 *     Not the drizzle adapter, so Better Auth managed its own connection and
 *     its own table expectations, independent of the schema this repo owns. It
 *     also initializes eagerly at import time, which meant importing any
 *     middleware opened a database connection — enough to make a unit test of a
 *     pure string predicate fail.
 *
 *   plugins: [organization({ allowUserToCreateOrganization: false })]
 *     The organization plugin expects `organization`, `member` and `invitation`
 *     tables and an `active_organization_id` column on `session`. NONE of them
 *     exist in this database — verified directly: public has `user`, `session`,
 *     `account` and `verification` only. (The similarly-named tables in the
 *     `neon_auth` schema belong to Neon's own managed auth and are unrelated.)
 *     So the plugin could only fail, and admin had already documented why it
 *     must stay off: it would duplicate the `organizations` / `org_members`
 *     tables this app actually scopes every query by.
 *
 *   No `secret`, no `baseURL`, and the comment "We'll configure this later".
 *
 * Tenancy is NOT Better Auth's job here. Identity is. The tenant is resolved
 * from `org_members` in `middlewares/authContext.ts`.
 *
 * WHY THE INSTANCE IS BUILT LAZILY, NOT AT MODULE SCOPE
 *
 * The old code read `process.env.BETTER_AUTH_SECRET` at module scope. On
 * Workers `process.env` is empty — even inside a handler (proven for
 * DATABASE_URL in db.ts; true for every secret) — and the module-scope boot
 * guard could not fire either, because its own NODE_ENV check read the same
 * empty source. Net effect in production: Better Auth configured with an
 * `undefined` signing secret, indistinguishable from working until a session
 * was forged. The secret is now resolved on first access through `envVar()`,
 * which reads the request's actual env binding captured by `dbContext()` —
 * which runs first in the chain, before `authContext()` or the `/api/auth/**`
 * handler can touch this module. `env` is constant per deployment, so caching
 * the built instance per isolate is correct.
 */
type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | null = null;

function buildAuth() {
  const secret = envVar('BETTER_AUTH_SECRET');

  // Fail loudly at first use rather than sign with `undefined`. The guard
  // moved here from module scope because module scope has no env on Workers.
  if (!secret && nodeEnv() === 'production') {
    throw new Error('BETTER_AUTH_SECRET must be set in production');
  }

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    secret,
    baseURL: envVar('API_BASE_URL') ?? 'http://localhost:8787',
  });
}

/**
 * Lazy handle over the Better Auth instance. First property access builds it,
 * after `dbContext()` has captured the request env. Function-valued
 * properties are bound to the real instance; nested objects (`auth.api`) are
 * returned as-is — their methods are closures over the instance, not `this`
 * dispatches, so no further binding is needed.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop, receiver) {
    if (!cached) cached = buildAuth();
    const value = Reflect.get(cached as object, prop, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(cached) : value;
  },
});
