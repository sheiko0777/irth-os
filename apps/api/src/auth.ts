import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
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
 */
// Fail at boot, not at the first login attempt in production with an unset
// secret — Better Auth would otherwise sign sessions with `undefined`, which
// is indistinguishable from working until someone forges one. Found in the
// archaeology sweep (a 2-month-stale claude/phase-a-production-boot branch
// had already caught this; ported the check, not the branch — everything
// else about that branch's auth.ts predates the drizzleAdapter rewrite above).
if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('BETTER_AUTH_SECRET must be set in production');
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.API_BASE_URL ?? 'http://localhost:8787',
});
