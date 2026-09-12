import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@irth/db';
import * as authSchema from '@irth/db/src/schema/auth';
import { resolveAppBaseUrl } from './appUrl';

/**
 * The Better Auth server instance.
 *
 * This did not exist. `auth-client.ts` called signIn.email() and `verifySession`
 * fetched /api/auth/get-session, but there was no route handler behind either —
 * both returned 404, so login could never succeed and every protected page sat
 * on the login screen forever. `verifySession` swallowed the 404 in its catch
 * and returned null, which is why it failed silently rather than loudly.
 *
 * The organization plugin is deliberately NOT enabled. It would create its own
 * `organization` and `member` tables, duplicating the `organizations` and
 * `org_members` this app already owns and scopes every query by. Tenancy stays
 * with the existing tables: createContext falls back to the user's first
 * org_members row when the session carries no active organization, which is
 * exactly the path taken without the plugin.
 *
 * Constructed lazily, same reason and same pattern as `db`'s own lazy Proxy
 * in `packages/db/src/index.ts`: Vercel does not expose "Sensitive"
 * environment variables during `next build`'s "Collecting page data" step,
 * only inside a real request. `betterAuth({ database: drizzleAdapter(db, ...) })`
 * being constructed eagerly at module import time is exactly such a build-time
 * import — and `drizzleAdapter`'s own constructor immediately reads `db._`
 * to inspect the schema, which — despite `db` itself being lazy — forces
 * that lazy Proxy's *first* real property access right there, at import
 * time, defeating it. That opened `postgres(process.env.DATABASE_URL!, ...)`
 * with `DATABASE_URL` undefined during build, which is what actually threw
 * `TypeError: Invalid URL` (not `NEXT_PUBLIC_APP_URL`/`baseURL`, the first,
 * plausible-but-wrong suspect — traced by reading better-auth's own
 * `drizzle-adapter.ts` and `packages/db`'s own prior fix for the identical
 * failure mode one layer down).
 *
 * The route handler (`/api/auth/[...all]/route.ts`) only ever calls
 * `auth.handler(request)` inside a real request, and `toNextJsHandler` only
 * touches `auth` inside that same request-time closure — never at import
 * time — so deferring construction here is enough on its own; the `db`
 * Proxy's own laziness stays intact once nothing forces it open early.
 */
let _authInstance: ReturnType<typeof betterAuth> | null = null;
function getAuthInstance() {
  if (!_authInstance) {
    _authInstance = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'pg',
        schema: authSchema,
      }),
      emailAndPassword: {
        enabled: true,
      },
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: resolveAppBaseUrl(),
    });
  }
  return _authInstance;
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop, _receiver) {
    const instance = getAuthInstance();
    const value = Reflect.get(instance as object, prop, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  // `toNextJsHandler` branches on `"handler" in auth` before calling it —
  // without this trap, `in` falls through to the empty placeholder target
  // and always reads false, misrouting every request.
  has(_target, prop) {
    return Reflect.has(getAuthInstance() as object, prop);
  },
});
