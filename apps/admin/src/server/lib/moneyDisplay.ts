import { divideRoundHalfEven } from '@irth/domain';

/**
 * Display-only helpers shared by the dashboard and analytics routers. Both
 * used to define identical (or near-identical) copies of these; consolidated
 * here rather than left to drift again.
 *
 * These are for rendering, not money arithmetic — do actual money math
 * through @irth/domain's Money type, never through these.
 */

/**
 * Truncates a minor-unit amount down to whole major units for display (e.g.
 * "1234" piastres -> 12 EGP). Accepts either a bigint or the decimal string
 * Drizzle returns for bigint columns, so both callers' existing value shapes
 * work unchanged.
 */
export function wholeMajorUnits(minor: bigint | string | null): number {
  const text = typeof minor === 'bigint' ? minor.toString() : (minor ?? '0');
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const whole = digits.length > 2 ? digits.slice(0, -2) : '0';
  const parsed = parseInt(whole || '0', 10);
  return negative ? -parsed : parsed;
}

export function percentDelta(current: bigint, previous: bigint): number | null {
  if (previous === BigInt(0)) return null;
  const tenths = divideRoundHalfEven((current - previous) * BigInt(1000), previous);
  return parseInt(tenths.toString(), 10) / 10;
}
