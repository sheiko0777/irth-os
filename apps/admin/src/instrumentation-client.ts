import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentryOptions';

// Browser-side errors. NEXT_PUBLIC_ because the value is inlined into the
// client bundle; a Sentry DSN is designed to be public. No-op when unset.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
