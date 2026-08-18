import type { MiddlewareHandler } from 'hono';
import { createDb, type DbInstance } from '@irth/db';

/**
 * Database handle for the Worker, built from the request's `env` binding.
 *
 * WHY NOT `process.env`, WHICH THIS USED TO DO
 *
 * The original was:
 *
 *     if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
 *     export const db = createDb(process.env.DATABASE_URL);
 *
 * Both lines run at module scope. On Cloudflare Workers that executes during
 * startup, before any request and before an environment exists, so the Worker
 * did not fail to reach Postgres — it failed to BOOT. Proven with
 * `wrangler dev`:
 *
 *     compatibility_date 2024-03-20 : Uncaught ReferenceError: process is not defined
 *     compatibility_date 2024-09-23 : Uncaught Error: DATABASE_URL is not set
 *     both: "The Workers runtime failed to start."
 *
 * Deferring the read to first use fixed startup — /health returned 200 — but
 * any route touching the database still returned 500 with the same message,
 * because **`process.env` is empty on Workers even inside a handler**, and even
 * with the value present in `.dev.vars`. `nodejs_compat` provides the `process`
 * global; it does not populate it from vars or secrets. Configuration on
 * Workers is reachable only through the `env` argument.
 *
 * Neither failure could be caught by CI: the gate runs lint, typecheck and
 * tests, and `deploy-api.yml` runs `wrangler deploy` with no smoke test. An
 * upload reports success while the runtime dies on first boot.
 *
 * HOW IT WORKS NOW
 *
 * `dbContext()` runs first in the middleware chain and hands this module the
 * request's env. `env` is constant for the lifetime of a deployment, so caching
 * the instance per isolate is correct and keeps connection reuse.
 */
type WorkerEnv = { DATABASE_URL?: string } & Record<string, unknown>;

let cached: DbInstance | null = null;
let envRef: WorkerEnv | null = null;

/** Captures the request env. Must run before anything touches the database. */
export const dbContext = (): MiddlewareHandler => async (c, next) => {
  envRef = c.env as WorkerEnv;
  await next();
};

export function getDb(): DbInstance {
  if (cached) return cached;

  // process.env first so Node contexts (tests, scripts, the migration runner)
  // keep working; the Worker path falls through to the captured env.
  const url = envRef?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. On Workers provide it via `wrangler secret put DATABASE_URL` ' +
        '(or apps/api/.dev.vars locally) and ensure dbContext() runs before any database access.',
    );
  }

  cached = createDb(url);
  return cached;
}

/**
 * Back-compat for the modules that already `import { db }`. Property access
 * resolves through getDb(), so nothing connects at import time and no call site
 * had to change.
 */
export const db = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});
