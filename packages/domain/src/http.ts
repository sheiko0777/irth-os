/**
 * One place that puts a bound on how long an outbound HTTP call can hang.
 *
 * Every external API this codebase calls (WhatsApp, Resend, Shopify, ETA,
 * Groq) previously called the bare global `fetch()` with no timeout at
 * all — a slow or wedged upstream held the request (and, on Cloudflare
 * Workers, the whole isolate handling it) open indefinitely. `fetchWithTimeout`
 * is a thin wrapper that aborts the request once `timeoutMs` has passed,
 * using the platform's own `AbortSignal.timeout()` rather than a hand-rolled
 * `setTimeout` + `AbortController` pair.
 */

/** Reasonable default for a typical external API round-trip (auth, webhook, REST/GraphQL call). */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
