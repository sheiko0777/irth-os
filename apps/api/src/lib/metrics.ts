/**
 * Provider send metrics — per-isolate, in-memory.
 *
 * WHAT THIS IS AND IS NOT: a cheap counters snapshot exposed on /ready so an
 * operator (or a uptime prober with JSON support) can see "this isolate
 * delivered 47 SMS, 12 WhatsApp, 3 email since it spun up, 2 providers
 * failed, breaker state". It is NOT a durable time-series: Workers
 * isolates are recycled unpredictably, so counters reset. The point is
 * point-in-time diagnosis — "is this worker sending anything, and are the
 * providers failing?" — not month-over-month graphs. Durable metrics are a
 * Workers Analytics Engine / statsd integration, deliberately out of scope
 * for this phase.
 *
 * REUSED ISOLATE CAVEAT: a busy isolate handles many requests, so these
 * numbers are meaningful for exactly the lifetime of one isolate. /ready
 * reports the isolate age alongside the counters so nobody mistakes a
 * young isolate's zeros for an outage.
 */

export type ProviderName = 'whatsapp' | 'sms' | 'email';

export interface ProviderMetrics {
    sent: number;
    failed: number;
    /** Last failure message, for /ready's human-facing diagnosis. */
    lastError: string | null;
    lastErrorAt: number | null;
}

interface MetricsState {
    startedAt: number;
    providers: Record<ProviderName, ProviderMetrics>;
}

function freshProvider(): ProviderMetrics {
    return { sent: 0, failed: 0, lastError: null, lastErrorAt: null };
}

const state: MetricsState = {
    startedAt: Date.now(),
    providers: {
        whatsapp: freshProvider(),
        sms: freshProvider(),
        email: freshProvider(),
    },
};

export function recordSend(provider: ProviderName): void {
    state.providers[provider].sent += 1;
}

export function recordProviderFailure(provider: ProviderName, error: string): void {
    const p = state.providers[provider];
    p.failed += 1;
    p.lastError = error.slice(0, 500);
    p.lastErrorAt = Date.now();
}

export interface MetricsSnapshot {
    isolateAgeSeconds: number;
    providers: Record<ProviderName, ProviderMetrics>;
    totals: { sent: number; failed: number };
}

export function metricsSnapshot(): MetricsSnapshot {
    const providers = {
        whatsapp: { ...state.providers.whatsapp },
        sms: { ...state.providers.sms },
        email: { ...state.providers.email },
    };
    const totals = {
        sent: providers.whatsapp.sent + providers.sms.sent + providers.email.sent,
        failed: providers.whatsapp.failed + providers.sms.failed + providers.email.failed,
    };
    return {
        isolateAgeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
        providers,
        totals,
    };
}

/** Test-only: resets counters so each test starts from zero. */
export function _resetMetrics(): void {
    state.startedAt = Date.now();
    state.providers = {
        whatsapp: freshProvider(),
        sms: freshProvider(),
        email: freshProvider(),
    };
}
