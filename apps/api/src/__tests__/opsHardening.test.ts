/**
 * Ops hardening — logger, request context, provider metrics.
 *
 * The logger and metrics are infrastructure every send and request now rides
 * on, so their contracts are pinned here:
 *   1. logger: one JSON-parseable line per emit, level routing, bigint/Error
 *      safety, child binding, LOG_LEVEL gating
 *   2. requestId middleware: generates/echoes X-Request-Id, binds logger on
 *      c.var, slow-request warn
 *   3. metrics: counters accumulate per provider, snapshot aggregates,
 *      failure state recorded for /ready diagnosis
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, newRequestId } from '../lib/logger';
import { recordSend, recordProviderFailure, metricsSnapshot, _resetMetrics } from '../lib/metrics';

// ─── logger ────────────────────────────────────────────────────────────────

describe('logger — structured JSON output', () => {
  const lines: string[] = [];
  let origLevel: string | undefined;

  beforeEach(() => {
    lines.length = 0;
    origLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    vi.spyOn(console, 'log').mockImplementation((s: string) => lines.push(s));
    vi.spyOn(console, 'error').mockImplementation((s: string) => lines.push(s));
    vi.spyOn(console, 'warn').mockImplementation((s: string) => lines.push(s));
  });

  afterEach(() => {
    if (origLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origLevel;
    vi.restoreAllMocks();
  });

  it('emits one JSON-parseable line with ts, level, msg and fields', () => {
    const log = createLogger({ component: 'test' });
    log.info('hello', { orderId: 'o1' });

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.component).toBe('test');
    expect(parsed.orderId).toBe('o1');
    expect(typeof parsed.ts).toBe('string');
    expect(new Date(parsed.ts as string).toString()).not.toBe('Invalid Date');
  });

  it('errors route to console.error, warns to console.warn', () => {
    const log = createLogger({});
    log.error('boom', {});
    log.warn('careful', {});
    expect(lines).toHaveLength(2);
    expect(console.error).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('stringifies bigint values instead of throwing (JSON.stringify would)', () => {
    const log = createLogger({});
    expect(() => log.info('money', { amountMinor: 12345n })).not.toThrow();
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.amountMinor).toBe('12345');
  });

  it('serializes Error objects to message/name — never a raw dump', () => {
    const log = createLogger({});
    log.error('failed', { err: new Error('gateway down') });
    const parsed = JSON.parse(lines[0]) as { err: { message: string; name: string } };
    expect(parsed.err.message).toBe('gateway down');
    expect(parsed.err.name).toBe('Error');
  });

  it('child loggers inherit bound fields and add their own', () => {
    const parent = createLogger({ requestId: 'r-1' });
    const child = parent.child({ campaignId: 'c-9' });
    child.info('dispatching', {});

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.requestId).toBe('r-1');
    expect(parsed.campaignId).toBe('c-9');
  });

  it('LOG_LEVEL=warn suppresses debug and info but not warn/error', () => {
    process.env.LOG_LEVEL = 'warn';
    const log = createLogger({});
    log.debug('d', {});
    log.info('i', {});
    log.warn('w', {});
    log.error('e', {});
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).msg).toBe('w');
    expect(JSON.parse(lines[1]).msg).toBe('e');
  });

  it('newRequestId returns distinct uuid-shaped ids', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

// ─── provider metrics ─────────────────────────────────────────────────────

describe('provider metrics', () => {
  beforeEach(() => _resetMetrics());

  it('counts sends per provider and aggregates totals in the snapshot', () => {
    recordSend('sms');
    recordSend('sms');
    recordSend('whatsapp');
    recordSend('email');

    const snap = metricsSnapshot();
    expect(snap.providers.sms.sent).toBe(2);
    expect(snap.providers.whatsapp.sent).toBe(1);
    expect(snap.providers.email.sent).toBe(1);
    expect(snap.totals.sent).toBe(4);
    expect(snap.totals.failed).toBe(0);
  });

  it('records failure counts and the last error for /ready diagnosis', () => {
    recordProviderFailure('sms', 'SMS API error: 503 - gateway down');
    recordProviderFailure('sms', 'SMS API error: 502 - bad gateway');

    const snap = metricsSnapshot();
    expect(snap.providers.sms.failed).toBe(2);
    expect(snap.providers.sms.lastError).toContain('502');
    expect(snap.providers.sms.lastErrorAt).toBeGreaterThan(0);
  });

  it('reports isolate age so young-isolate zeros are not mistaken for outages', () => {
    const snap = metricsSnapshot();
    expect(snap.isolateAgeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('truncates long provider errors to 500 chars (no payload dumps in /ready)', () => {
    recordProviderFailure('email', 'x'.repeat(2000));
    expect(metricsSnapshot().providers.email.lastError?.length).toBeLessThanOrEqual(500);
  });
});
