import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentryOptions';

/**
 * Error reporting for the server and edge runtimes. Next calls `register`
 * once per runtime at startup; `onRequestError` receives every uncaught error
 * from server components, route handlers (tRPC included) and middleware.
 * See lib/sentryOptions.ts for why this is a no-op without SENTRY_DSN.
 */
export async function register() {
  // Not even initialised without a DSN: an inert SDK still installs hooks.
  if (process.env.SENTRY_DSN) Sentry.init(sentryOptions(process.env.SENTRY_DSN));
}

export const onRequestError = Sentry.captureRequestError;
