/**
 * The Postgres SQLSTATE behind a database error, if any.
 *
 * drizzle-orm 0.45 wraps driver errors in DrizzleQueryError, so the code lives
 * on `err.cause.code`; raw driver errors carry it on `err.code`. Checking only
 * `err.code` silently misses every real unique violation.
 */
export function pgErrorCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** True for unique_violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}
