/**
 * Structured JSON logger.
 *
 * WHY JSON, not console.log prose: Workers Logs (and every log aggregator —
 * Datadog, Grafana Loki, Better Stack) parse one JSON object per line into
 * queryable fields. `console.error('ETA issueInvoice error:', err)` renders
 * as prose a human has to eyeball; {"level":"error","msg":"eta.issueInvoice
 * failed","requestId":"...","orderId":"..."} is a filterable field in a
 * dashboard and a correlation key across every line of one request.
 *
 * WHY NO PINO: Workers have no stdout file descriptors to reuse — logs go to
 * the Workers Logs pipeline via console.* — so a JSON.stringify per line is
 * the whole job. A dependency would buy nothing here.
 *
 * SECURITY: fields are stringified defensively; an Error becomes
 * {message, name, stack?} — never a raw object dump that could embed
 * customer PII from payload objects nobody meant to log.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * The minimum level that actually emits. Read per-emit (not cached at module
 * load) so a config change applies without isolating recycling — and so tests
 * can flip LOG_LEVEL. Raise to 'warn'/'error' in prod via LOG_LEVEL.
 */
function minLevel(): LogLevel {
    const raw = (process.env.LOG_LEVEL as LogLevel | undefined)?.toLowerCase();
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
    return (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
}

export interface LogContext {
    [key: string]: unknown;
}

/** Coerces anything into a JSON-safe value without ever throwing. */
function safeValue(v: unknown): unknown {
    if (v === undefined) return null;
    if (v instanceof Error) return { message: v.message, name: v.name, stack: v.stack };
    if (typeof v === 'bigint') return v.toString(); // JSON.stringify throws on bigint
    if (typeof v === 'object') {
        try {
            JSON.stringify(v); // rejects circular structures
            return v;
        } catch {
            return '[unserializable]';
        }
    }
    return v;
}

/** Strips keys with undefined values so every emitted line is stable JSON. */
function sanitize(ctx: LogContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx)) {
        if (v === undefined) continue;
        out[k] = safeValue(v);
    }
    return out;
}

function emit(level: LogLevel, msg: string, ctx: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel()]) return;
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...sanitize(ctx),
    });
    // Workers Logs ingests console.*; level routes to the right stream so
    // `wrangler tail --format pretty` colors by severity.
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

/**
 * A logger bound to a correlation id (usually a request id). `child` binds
 * MORE fields — e.g. the worker binds {tick: true, drain: batchCount} — so
 * one request's lines stay joinable by requestId, one campaign's by
 * campaignId, without threading a logger instance through every signature.
 */
export interface Logger {
    debug(msg: string, ctx?: LogContext): void;
    info(msg: string, ctx?: LogContext): void;
    warn(msg: string, ctx?: LogContext): void;
    error(msg: string, ctx?: LogContext): void;
    child(fields: LogContext): Logger;
}

export function createLogger(base: LogContext = {}): Logger {
    const bound = sanitize(base);
    return {
        debug: (msg, ctx = {}) => emit('debug', msg, { ...bound, ...sanitize(ctx) }),
        info: (msg, ctx = {}) => emit('info', msg, { ...bound, ...sanitize(ctx) }),
        warn: (msg, ctx = {}) => emit('warn', msg, { ...bound, ...sanitize(ctx) }),
        error: (msg, ctx = {}) => emit('error', msg, { ...bound, ...sanitize(ctx) }),
        child: (fields) => createLogger({ ...bound, ...sanitize(fields) }),
    };
}

/** Cryptographically random request id — crypto.randomUUID exists in Workers + Node 19+. */
export function newRequestId(): string {
    return crypto.randomUUID();
}
