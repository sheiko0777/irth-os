/**
 * Money as an integer count of minor units (CLAUDE.md rule 1).
 *
 * Every float defect in this codebase comes from treating money as a `number`
 * or a decimal string: VAT as `Number(total) * 0.14`, lifetime revenue as
 * `parseFloat(x).toFixed(2)`, line totals that do not sum to their header.
 * Binary floating point cannot represent 0.01, so those errors are not rare
 * edge cases — they accumulate on every read-modify-write.
 *
 * Deliberately zero runtime dependencies: this package is imported by the
 * Next.js admin, a Cloudflare Worker, and React Native, and the only
 * non-trivial algorithm here (`allocate`) is ~30 lines. `dinero.js` would give
 * the same guarantees at the cost of a dependency in all three runtimes.
 */

/** ISO 4217 code. Branded so a bare string cannot be passed as a currency. */
export type Currency = string & { readonly __brand: 'Currency' };

/**
 * How many decimal places a currency has. EGP, USD, SAR and AED are all 2.
 * Kept as a lookup rather than a constant because the Gulf market includes
 * KWD/BHD/OMR at 3 — adding one here must not require touching arithmetic.
 */
const EXPONENTS: Readonly<Record<string, number>> = {
  EGP: 2,
  USD: 2,
  SAR: 2,
  AED: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

const DEFAULT_EXPONENT = 2;

export function currency(code: string): Currency {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new TypeError(`Not an ISO 4217 currency code: ${JSON.stringify(code)}`);
  }
  return code as Currency;
}

export const EGP = currency('EGP');

export function exponentOf(c: Currency): number {
  return EXPONENTS[c] ?? DEFAULT_EXPONENT;
}

/**
 * An amount, as a whole number of minor units (piastres for EGP), plus the
 * currency it is denominated in. There is no fractional field by design: if a
 * value cannot be expressed in whole minor units it is not an amount of money,
 * it is an intermediate result that has not been resolved yet.
 */
export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

export function fromMinor(minor: bigint | number, c: Currency = EGP): Money {
  if (typeof minor === 'number' && !Number.isSafeInteger(minor)) {
    throw new TypeError(`Minor units must be a safe integer, got ${minor}`);
  }
  return { minor: BigInt(minor), currency: c };
}

export function zero(c: Currency = EGP): Money {
  return { minor: 0n, currency: c };
}

/**
 * Parses a decimal string — "1234.56" — into minor units without ever
 * constructing a float.
 *
 * `Number("0.1") * 100` is 10.000000000000002, so parseFloat-then-multiply
 * silently corrupts roughly one value in ten. This walks the digits instead,
 * which is also what makes it safe to run over existing `numeric(12,2)` columns
 * during the migration off decimals.
 *
 * Throws on more precision than the currency has, rather than rounding: a value
 * with unexpected precision means an assumption is wrong, and rounding it here
 * would hide that at exactly the moment it matters.
 */
export function parseDecimal(input: string, c: Currency = EGP): Money {
  const text = input.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new TypeError(`Not a decimal amount: ${JSON.stringify(input)}`);
  }

  const [, sign, whole, fraction = ''] = match;
  const exponent = exponentOf(c);

  const significant = fraction.replace(/0+$/, '');
  if (significant.length > exponent) {
    throw new RangeError(
      `${JSON.stringify(input)} has ${significant.length} decimal places but ${c} has ${exponent}`,
    );
  }

  const padded = fraction.padEnd(exponent, '0').slice(0, exponent);
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(padded || '0');
  return { minor: sign ? -minor : minor, currency: c };
}

/** Renders minor units back to a plain decimal string. No locale, no symbol. */
export function toDecimalString(m: Money): string {
  const exponent = exponentOf(m.currency);
  const negative = m.minor < 0n;
  const digits = (negative ? -m.minor : m.minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const body = exponent === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Currency mismatch: ${a.currency} and ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function negate(m: Money): Money {
  return { minor: -m.minor, currency: m.currency };
}

export function sum(items: readonly Money[], c: Currency = EGP): Money {
  return items.reduce(add, zero(c));
}

/** Scales by a whole quantity — a line total is unit price times an integer. */
export function multiply(m: Money, quantity: bigint | number): Money {
  if (typeof quantity === 'number' && !Number.isSafeInteger(quantity)) {
    throw new TypeError(`Quantity must be a whole number, got ${quantity}`);
  }
  return { minor: m.minor * BigInt(quantity), currency: m.currency };
}

/**
 * Integer division rounding half to even ("banker's rounding").
 *
 * Half-up biases every tie in the same direction, so over a ledger's worth of
 * VAT lines the error accumulates instead of cancelling. Half-to-even is what
 * accounting systems and IEEE 754's default mode both use.
 */
export function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');

  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;
  const twice = remainder * 2n;

  let rounded = quotient;
  if (twice > d) {
    rounded = quotient + 1n;
  } else if (twice === d) {
    // Exactly half: go to the even neighbour.
    rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
  }

  return negative ? -rounded : rounded;
}

/** One basis point is 1/100th of a percent. 14% VAT is 1400 bp. */
export const PERCENT_BP = 100;
const BP_SCALE = 10_000n;

/**
 * Applies a rate expressed in basis points.
 *
 * Rates are integers precisely so that nobody writes `total * 0.14`. 14% VAT is
 * `applyRate(total, 1400)`, and the result is rounded once, here, rather than
 * accumulating an unrounded fraction into a later sum.
 */
export function applyRate(m: Money, basisPoints: number): Money {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new TypeError(`Basis points must be a whole number, got ${basisPoints}`);
  }
  return {
    minor: divideRoundHalfEven(m.minor * BigInt(basisPoints), BP_SCALE),
    currency: m.currency,
  };
}

/**
 * The tax already contained inside a tax-inclusive amount.
 *
 * `applyRate` adds tax on top of a net figure; this extracts it from a gross
 * one. Confusing the two is the defect in `finance.vatReport`, which computed
 * VAT as `gross * 0.14` (the exclusive formula) and net as `gross * 0.86` (an
 * inclusive one, and the wrong one — the inclusive net is gross / 1.14, about
 * 0.8772). The two agreed only because 0.14 + 0.86 happens to be 1.
 *
 * For a gross amount G and rate r: tax = G x r / (1 + r), net = G - tax.
 * Deriving net by subtraction rather than its own division guarantees
 * net + tax === gross with no stray piastre.
 */
export function taxIncludedIn(gross: Money, basisPoints: number): Money {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new TypeError(`Basis points must be a whole number, got ${basisPoints}`);
  }
  const bp = BigInt(basisPoints);
  return {
    minor: divideRoundHalfEven(gross.minor * bp, BP_SCALE + bp),
    currency: gross.currency,
  };
}

/** The net (tax-exclusive) part of a tax-inclusive amount. */
export function netOfTax(gross: Money, basisPoints: number): Money {
  return subtract(gross, taxIncludedIn(gross, basisPoints));
}

/** Egyptian VAT, in basis points. */
export const EGYPT_VAT_BP = 1400;

/**
 * Splits an amount across weights so the parts sum back to the original exactly.
 *
 * Rounding each share independently does not add up: 100 split three ways gives
 * 33.33 x 3 = 99.99, and the missing piastre turns into an invoice whose lines
 * disagree with its total. The largest-remainder method hands the leftover
 * units to the shares with the largest truncated fraction, so the sum is exact
 * by construction.
 *
 * Weights are bigint (typically line totals or quantities) rather than floats,
 * so the proportions themselves cannot drift.
 */
export function allocate(m: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
  if (weights.some((w) => w < 0n)) throw new RangeError('allocate weights must be non-negative');

  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) throw new RangeError('allocate weights must not all be zero');

  const negative = m.minor < 0n;
  const magnitude = negative ? -m.minor : m.minor;

  // Truncated shares, plus the remainder each one gave up. Working on the
  // magnitude keeps the floor consistent for negative amounts — otherwise a
  // refund would round in the opposite direction to the charge it reverses.
  const shares = weights.map((weight, index) => {
    const scaled = magnitude * weight;
    return { index, base: scaled / totalWeight, remainder: scaled % totalWeight };
  });

  let leftover = magnitude - shares.reduce((acc, s) => acc + s.base, 0n);

  // Largest remainder first; ties fall to the earlier index so the split is
  // deterministic and a re-run produces identical invoice lines.
  const order = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );

  const extra = new Array<bigint>(weights.length).fill(0n);
  for (const share of order) {
    if (leftover <= 0n) break;
    extra[share.index] = 1n;
    leftover -= 1n;
  }

  return shares.map((s) => ({
    minor: negative ? -(s.base + extra[s.index]) : s.base + extra[s.index],
    currency: m.currency,
  }));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

export const equals = (a: Money, b: Money): boolean => compare(a, b) === 0;
export const isZero = (m: Money): boolean => m.minor === 0n;
export const isNegative = (m: Money): boolean => m.minor < 0n;
export const isPositive = (m: Money): boolean => m.minor > 0n;

/** Larger of two amounts — used to clamp a discount to the order total. */
export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}
