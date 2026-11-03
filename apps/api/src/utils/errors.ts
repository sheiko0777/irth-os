import { createLogger } from '../lib/logger';
import { nodeEnv } from './env';

/**
 * `NODE_ENV` is read at request time, not module scope: on Workers
 * `process.env` is empty (see db.ts), so a frozen module-scope check would
 * always take the "development" branch and leak raw internal error strings —
 * Postgres constraint messages included — to clients in production.
 */
export function handleError(error: unknown): string {
  createLogger().error("API Error:", { err: error });
  if (nodeEnv() === "production") {
    return "internal_server_error";
  }
  return error instanceof Error ? error.message : String(error);
}
