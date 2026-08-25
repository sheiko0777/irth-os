import { dinero, add, multiply, toSnapshot, EGP } from 'dinero.js';
import type { Dinero } from 'dinero.js';

/**
 * All money in this codebase is represented as an integer count of minor
 * units (piastres for EGP — 100 minor units = 1 EGP), never as a float and
 * never as a JS `number` produced by float arithmetic. This module is the
 * only place that is allowed to do money arithmetic; every other module
 * should treat amounts as opaque integers and call these helpers.
 *
 * DB columns store minor units as `bigint(..., { mode: 'number' })` — safe
 * because a JS `number` represents any integer up to 2^53 exactly, which is
 * far beyond any realistic order/ledger amount in piastres.
 */
export type MinorUnits = number;

/** Wraps an integer minor-unit amount as a Dinero object for arithmetic. */
export function egp(amountMinor: MinorUnits): Dinero<number> {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Money amount must be an integer number of minor units, got: ${amountMinor}`);
  }
  return dinero({ amount: amountMinor, currency: EGP });
}

/** Sums a list of minor-unit amounts using exact integer arithmetic. */
export function sumMinor(amounts: MinorUnits[]): MinorUnits {
  const total = amounts.reduce((acc, m) => add(acc, egp(m)), egp(0));
  return toSnapshot(total).amount;
}

/** unitPriceMinor * quantity, computed via Dinero (still exact integer arithmetic). */
export function multiplyMinorByQuantity(unitPriceMinor: MinorUnits, quantity: number): MinorUnits {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`Quantity must be a non-negative integer, got: ${quantity}`);
  }
  return toSnapshot(multiply(egp(unitPriceMinor), quantity)).amount;
}

/**
 * Parses a decimal string like "123.45" (as stored in the legacy
 * `numeric`/`decimal` columns, or received from external APIs) into integer
 * minor units (12345). Pure string manipulation — never touches
 * floating-point arithmetic, so it cannot introduce the rounding errors
 * `parseFloat(x) * 100` would.
 */
export function decimalStringToMinor(value: string | number | null | undefined): MinorUnits {
  if (value === null || value === undefined) return 0;
  const str = String(value).trim();
  if (str === '') return 0;

  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const parts = unsigned.split('.');
  if (parts.length > 2) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }
  const [wholePartRaw, fracPartRaw = ''] = parts;
  const wholePart = wholePartRaw === '' ? '0' : wholePartRaw;

  if (!/^\d+$/.test(wholePart) || !/^\d*$/.test(fracPartRaw)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  // EGP has 2 decimal places; pad short fractions, truncate (never round) long ones.
  const frac = (fracPartRaw + '00').slice(0, 2);
  const minor = Number(wholePart) * 100 + Number(frac);
  return negative ? -minor : minor;
}

/** The inverse of decimalStringToMinor — for display or writing back to legacy decimal columns. */
export function minorToDecimalString(minor: MinorUnits): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Tax rate in basis points: 1400 = 14.00%, 500 = 5.00%, 0 = zero-rated.
 * Basis points keep the rate an exact integer, so a rate can never pick up
 * the float error this module exists to prevent (0.14 is not representable
 * in binary floating point; 1400 is).
 */
export type RateBps = number;

/** Rounds half away from zero, on exact integer inputs. */
function divRound(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  return sign * Math.floor((abs + Math.floor(denominator / 2)) / denominator);
}

/**
 * Splits a set of line amounts into the subtotal/tax/total triple that the
 * `orders` table records, under an explicit tax-inclusive-or-not convention.
 *
 * The convention is a parameter, never an assumption: reading the same
 * stored number as tax-inclusive in one module and tax-exclusive in another
 * is exactly the bug this function was written to retire (finance.vatReport
 * and services/eta.ts each guessed, and guessed differently).
 *
 * Guarantees, for both conventions and any rate:
 *   subtotalMinor + taxAmountMinor === totalAmountMinor
 * This invariant is also enforced as a CHECK constraint on `orders`, so a
 * row that violates it cannot be written even by code that bypasses this
 * helper.
 */
export function splitTax(
  lineTotalMinor: MinorUnits,
  rateBps: RateBps,
  pricesIncludeTax: boolean,
): { subtotalMinor: MinorUnits; taxAmountMinor: MinorUnits; totalAmountMinor: MinorUnits } {
  if (!Number.isInteger(lineTotalMinor)) {
    throw new Error(`lineTotalMinor must be an integer, got: ${lineTotalMinor}`);
  }
  if (!Number.isInteger(rateBps) || rateBps < 0) {
    throw new Error(`rateBps must be a non-negative integer, got: ${rateBps}`);
  }

  if (pricesIncludeTax) {
    // Catalog price is what the customer pays; the tax is already inside it.
    // tax = gross * rate / (10000 + rate)
    const taxAmountMinor = divRound(lineTotalMinor * rateBps, 10000 + rateBps);
    return {
      subtotalMinor: lineTotalMinor - taxAmountMinor,
      taxAmountMinor,
      totalAmountMinor: lineTotalMinor,
    };
  }

  // Catalog price is net; tax is added on top.
  const taxAmountMinor = divRound(lineTotalMinor * rateBps, 10000);
  return {
    subtotalMinor: lineTotalMinor,
    taxAmountMinor,
    totalAmountMinor: lineTotalMinor + taxAmountMinor,
  };
}
