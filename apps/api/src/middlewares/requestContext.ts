import { MiddlewareHandler } from 'hono';
import { createLogger, newRequestId, type Logger } from '../lib/logger';

/**
 * Per-request correlation, in one middleware.
 *
 * - Honors an inbound X-Request-Id (a Vercel/Next.js request that fanned out
 *   to this API may carry one; same id then joins the whole trace across
 *   both apps) and echoes it back on the response so support can ask a
 *   user for "the id in your browser devtools" and find the exact lines.
 * - Generates one when absent. TRUSTED_REQUEST_ID_HEADER=1 opts IN to
 *   trusting inbound ids; default off because a spoofable correlation key
 *   is a log-injection vector (an attacker floods your dashboard with fake
 *   ids to hide their real activity among them).
 * - Binds a Logger with {requestId, method, path} onto c.var, so handlers
 *   read `c.var.logger` and every line carries the id without hand-threading.
 * - Slow-request warning at 2s: the Workers CPU budget is 10-50ms paid
 *   (wall time higher), so a 2s request is already pathological and worth a
 *   warn line in tail before anyone opens a dashboard.
 *
 * c.var typing: the Env interface lives in the declared-module block
 * below; hono merges it with the app's other generics.
 */

declare module 'hono' {
    interface ContextVariableMap {
        logger: Logger;
        requestId: string;
    }
}

const SLOW_REQUEST_MS = 2_000;

export const requestContext: MiddlewareHandler = async (c, next) => {
    const inbound = c.req.header('X-Request-Id');
    const trustInbound = process.env.TRUSTED_REQUEST_ID_HEADER === '1';
    const requestId = (inbound && trustInbound && inbound.length <= 128) ? inbound : newRequestId();

    const logger = createLogger({
        requestId,
        method: c.req.method,
        path: c.req.path,
    });

    c.set('requestId', requestId);
    c.set('logger', logger);

    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;

    c.header('X-Request-Id', requestId);

    if (durationMs >= SLOW_REQUEST_MS) {
        logger.warn('slow request', { durationMs, status: c.res.status });
    } else {
        logger.debug('request complete', { durationMs, status: c.res.status });
    }
};
