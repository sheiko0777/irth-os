import type { ErrorEvent } from '@sentry/cloudflare';

/**
 * Sentry options for the Worker. Off unless the SENTRY_DSN secret is set, so
 * `wrangler dev`, tests and any environment without it behave as before.
 *
 * Nothing personal leaves the Worker: this API receives Shopify orders,
 * courier webhooks and Paymob payloads full of names, phones and addresses.
 * Personal data is not collected by default, and every event has its request cookies, headers,
 * body and query string removed before sending — the stack and the route are
 * what an operator needs to act on a crash. Tracing is off (free tier).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}

export function sentryOptions(env: Record<string, unknown> | undefined) {
  const dsn = typeof env?.SENTRY_DSN === 'string' && env.SENTRY_DSN ? env.SENTRY_DSN : undefined;
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: typeof env?.NODE_ENV === 'string' ? env.NODE_ENV : 'production',
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}
