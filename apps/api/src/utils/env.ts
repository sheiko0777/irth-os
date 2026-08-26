import { getEnv } from '../db';

/**
 * Reads configuration from the captured Worker env (`dbContext()` /
 * `captureEnv`), falling back to `process.env` so Node contexts (tests,
 * scripts) keep working unchanged. See db.ts's file-header comment for the
 * proven reason `process.env` alone is empty on Workers — even inside a
 * handler, even for secrets set via `wrangler secret put`.
 */
export function envVar(key: string): string | undefined {
  return (getEnv()?.[key] as string | undefined) ?? process.env[key];
}

/** Same as {@link envVar} but for NODE_ENV-style environment switches. */
export function nodeEnv(): string | undefined {
  return envVar('NODE_ENV');
}
