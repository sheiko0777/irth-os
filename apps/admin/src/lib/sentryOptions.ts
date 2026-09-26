/**
 * Shared Sentry options for the admin app (server, edge and browser).
 *
 * Off unless a DSN is configured: with no DSN, `init` installs nothing and
 * every capture is a no-op, so local dev, tests and preview deployments
 * without the variable behave exactly as before.
 *
 * No personal data leaves the app. This is an ERP holding customers' names,
 * phones and addresses: `sendDefaultPii` is off, and `beforeSend` strips
 * cookies, headers, request bodies and query strings from every event, so an
 * error report carries the stack and the route, not the session or the order.
 * Performance tracing is off (sample rate 0) to stay inside the free tier;
 * the goal here is "we hear about every crash", not APM.
 */
import type { ErrorEvent } from '@sentry/nextjs';

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

export function sentryOptions(dsn: string | undefined) {
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}
