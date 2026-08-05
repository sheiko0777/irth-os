import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@irth/db';
import * as authSchema from '@irth/db/src/schema/auth';

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
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
});
