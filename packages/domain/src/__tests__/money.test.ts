import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EGP,
  EGYPT_VAT_BP,
  add,
  allocate,
  applyRate,
  currency,
  divideRoundHalfEven,
  fromMinor,
  multiply,
  netOfTax,
  parseDecimal,
  subtract,
  sum,
  taxIncludedIn,
  toDecimalString,
  zero,
} from '../money';

/** Amounts up to ~90 billion EGP, positive and negative. */
const amount = fc.bigInt({ min: -9_000_000_000_000n, max: 9_000_000_000_000n });
const money = amount.map((minor) => fromMinor(minor, EGP));

describe('parseDecimal / toDecimalString', () => {
  it('round-trips any amount', () => {
    fc.assert(
      fc.property(money, (m) => {
        expect(parseDecimal(toDecimalString(m), EGP)).toEqual(m);
      }),
    );
  });

  it('reads the decimal strings the numeric columns currently hold', () => {
    expect(parseDecimal('1234.56').minor).toBe(123456n);
    expect(parseDecimal('0.01').minor).toBe(1n);
    expect(parseDecimal('0.10').minor).toBe(10n);
    expect(parseDecimal('1000').minor).toBe(100000n);
    expect(parseDecimal('-45.99').minor).toBe(-4599n);
  });

  it('does not go through a float', () => {
    // Being precise about what is and is not wrong with the float path, because
    // overstating it is how a rule stops being believed:
    //
    // A SINGLE parse of a two-decimal string is actually safe —
    // Math.round(Number(s) * 100) is correct for every two-decimal value in a
    // realistic range, even though 271 of the first 2000 produce an inexact
    // product (0.07 * 100 === 7.000000000000001). The rounding hides it.
    expect(Number('0.07') * 100).not.toBe(7); // inexact...
    expect(Math.round(Number('0.07') * 100)).toBe(7); // ...but rounds correctly

    // What is not safe is everything after that first parse: accumulation,
    // multiplication chains, and rate application. parseDecimal avoids the
    // question entirely by never constructing a float.
    expect(parseDecimal('0.07').minor).toBe(7n);
    expect(parseDecimal('1234.56').minor).toBe(123456n);
  });

  it('refuses more precision than the currency has, instead of rounding', () => {
    // Silently rounding here would hide a wrong assumption at the one moment
    // it is cheap to notice.
    expect(() => parseDecimal('1.005')).toThrow(/decimal places/);
    expect(() => parseDecimal('1.500', EGP)).not.toThrow(); // trailing zero is not precision
    expect(() => parseDecimal('abc')).toThrow(/Not a decimal amount/);
  });

  it('handles a 3-decimal currency', () => {
    const kwd = currency('KWD');
    expect(parseDecimal('1.234', kwd).minor).toBe(1234n);
    expect(toDecimalString(fromMinor(1234n, kwd))).toBe('1.234');
  });
});

describe('arithmetic', () => {
  it('add and subtract are inverses', () => {
    fc.assert(
      fc.property(money, money, (a, b) => {
        expect(subtract(add(a, b), b)).toEqual(a);
      }),
    );
  });

  it('refuses to mix currencies', () => {
    expect(() => add(fromMinor(100n, EGP), fromMinor(100n, currency('USD')))).toThrow(
      /Currency mismatch/,
    );
  });

  it('multiplies by whole quantities only', () => {
    expect(multiply(fromMinor(1999n), 3).minor).toBe(5997n);
    expect(() => multiply(fromMinor(100n), 1.5)).toThrow(/whole number/);
  });

  it('sums a list exactly', () => {
    fc.assert(
      fc.property(fc.array(money, { maxLength: 50 }), (items) => {
        const expected = items.reduce((acc, m) => acc + m.minor, 0n);
        expect(sum(items, EGP).minor).toBe(expected);
      }),
    );
  });
});

describe('divideRoundHalfEven', () => {
  it('never lands further than half a denominator from the true quotient', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (n, d) => {
          const q = divideRoundHalfEven(n, d);
          const error = q * d - n;
          const magnitude = error < 0n ? -error : error;
          expect(magnitude * 2n <= d).toBe(true);
        },
      ),
    );
  });

  it('sends exact halves to the even neighbour', () => {
    expect(divideRoundHalfEven(5n, 2n)).toBe(2n); // 2.5 -> 2
    expect(divideRoundHalfEven(7n, 2n)).toBe(4n); // 3.5 -> 4
    expect(divideRoundHalfEven(-5n, 2n)).toBe(-2n);
    expect(divideRoundHalfEven(-7n, 2n)).toBe(-4n);
  });

  it('is unbiased across ties, unlike half-up', () => {
    // Half-up pushes every tie the same way, so the error accumulates over a
    // ledger instead of cancelling.
    // 100 exact halves: 0.5, 1.5, 2.5, … 99.5
    const halves = Array.from({ length: 100 }, (_, i) => BigInt(2 * i + 1));
    const bankers = halves.reduce((acc, n) => acc + divideRoundHalfEven(n, 2n), 0n);
    const halfUp = halves.reduce((acc, n) => acc + (n + 1n) / 2n, 0n);
    const exactDoubled = halves.reduce((acc, n) => acc + n, 0n); // 2 x the true sum

    // Banker's rounding lands on the true total exactly — the ups and downs
    // cancel. Half-up is 50 units high, one per tie, all in the same direction.
    expect(bankers * 2n).toBe(exactDoubled);
    expect(halfUp * 2n - exactDoubled).toBe(100n);
    expect(halfUp - bankers).toBe(50n);
  });

  it('rejects division by zero', () => {
    expect(() => divideRoundHalfEven(1n, 0n)).toThrow(/zero/);
  });
});

describe('applyRate', () => {
  it('100% is identity and 0% is zero', () => {
    fc.assert(
      fc.property(money, (m) => {
        expect(applyRate(m, 10_000)).toEqual(m);
        expect(applyRate(m, 0).minor).toBe(0n);
      }),
    );
  });

  it('computes Egyptian VAT without a float literal', () => {
    // services/eta.ts does `Number(order.totalAmount) * 0.14` today.
    const net = parseDecimal('1234.56');
    expect(toDecimalString(applyRate(net, 1400))).toBe('172.84');
  });

  it('differs from the float path on ties, always in the same direction', () => {
    // 0.75 * 14% is exactly 10.5 piastres. Math.round takes every such tie up;
    // banker's rounding sends half of them down. Across 200k net amounts the
    // two disagree on ~1% of values, and every disagreement is the float path
    // reading high — a systematic over-collection of VAT, not noise that
    // averages out.
    expect(Math.round((75 / 100) * 0.14 * 100)).toBe(11);
    expect(applyRate(fromMinor(75n), 1400).minor).toBe(10n);

    let disagreements = 0;
    for (let piastres = 1; piastres <= 20_000; piastres += 1) {
      const viaFloat = Math.round((piastres / 100) * 0.14 * 100);
      const exact = applyRate(fromMinor(BigInt(piastres)), 1400).minor;
      if (BigInt(viaFloat) !== exact) {
        disagreements += 1;
        expect(BigInt(viaFloat) > exact).toBe(true); // never lower
      }
    }
    expect(disagreements).toBe(200); // 1 in every 100
  });

  it('rejects fractional basis points', () => {
    expect(() => applyRate(fromMinor(100n), 14.5)).toThrow(/whole number/);
  });
});

describe('taxIncludedIn / netOfTax', () => {
  it('always reconciles: net + tax === gross', () => {
    fc.assert(
      fc.property(money, (gross) => {
        const tax = taxIncludedIn(gross, EGYPT_VAT_BP);
        const net = netOfTax(gross, EGYPT_VAT_BP);
        expect(add(net, tax)).toEqual(gross);
      }),
    );
  });

  it('is the inverse of adding tax on top', () => {
    // Whatever net produces this gross, extracting gets back to it.
    const net = parseDecimal('1000.00');
    const gross = add(net, applyRate(net, EGYPT_VAT_BP));
    expect(toDecimalString(gross)).toBe('1140.00');
    expect(netOfTax(gross, EGYPT_VAT_BP)).toEqual(net);
  });

  it('is not the exclusive formula finance.vatReport used', () => {
    const gross = parseDecimal('1140.00');
    // What the code did: gross * 0.14 and gross * 0.86.
    expect(1140 * 0.14).toBeCloseTo(159.6, 2); // claimed VAT
    expect(1140 * 0.86).toBeCloseTo(980.4, 2); // claimed net
    // What is actually inside a VAT-inclusive 1140.00:
    expect(toDecimalString(taxIncludedIn(gross, EGYPT_VAT_BP))).toBe('140.00');
    expect(toDecimalString(netOfTax(gross, EGYPT_VAT_BP))).toBe('1000.00');
  });
});

describe('allocate', () => {
  const weights = fc.array(fc.bigInt({ min: 0n, max: 10_000n }), {
    minLength: 1,
    maxLength: 20,
  });

  it('always sums back to the original amount', () => {
    // The invariant that matters: invoice lines must reconcile to the header.
    fc.assert(
      fc.property(money, weights, (m, w) => {
        fc.pre(w.some((x) => x > 0n));
        const parts = allocate(m, w);
        expect(parts.reduce((acc, p) => acc + p.minor, 0n)).toBe(m.minor);
      }),
    );
  });

  it('gives every part the same sign as the total', () => {
    fc.assert(
      fc.property(money, weights, (m, w) => {
        fc.pre(w.some((x) => x > 0n));
        for (const part of allocate(m, w)) {
          if (m.minor >= 0n) expect(part.minor >= 0n).toBe(true);
          else expect(part.minor <= 0n).toBe(true);
        }
      }),
    );
  });

  it('keeps each part within one minor unit of its exact share', () => {
    fc.assert(
      fc.property(money, weights, (m, w) => {
        fc.pre(w.some((x) => x > 0n));
        const total = w.reduce((a, b) => a + b, 0n);
        const parts = allocate(m, w);

        parts.forEach((part, i) => {
          const exactTimesTotal = m.minor * w[i];
          const partTimesTotal = part.minor * total;
          const drift = partTimesTotal - exactTimesTotal;
          const magnitude = drift < 0n ? -drift : drift;
          expect(magnitude <= total).toBe(true);
        });
      }),
    );
  });

  it('splits the classic 100 / 3 without losing a piastre', () => {
    // Rounding each share independently gives 33.33 x 3 = 99.99 and an invoice
    // whose lines disagree with its total.
    const parts = allocate(parseDecimal('100.00'), [1n, 1n, 1n]);
    expect(parts.map(toDecimalString)).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts, EGP)).toEqual(parseDecimal('100.00'));
  });

  it('is deterministic when remainders tie', () => {
    const a = allocate(fromMinor(10n), [1n, 1n, 1n]);
    const b = allocate(fromMinor(10n), [1n, 1n, 1n]);
    expect(a).toEqual(b);
  });

  it('rejects weightings it cannot split', () => {
    expect(() => allocate(fromMinor(100n), [])).toThrow(/at least one/);
    expect(() => allocate(fromMinor(100n), [0n, 0n])).toThrow(/not all be zero/);
    expect(() => allocate(fromMinor(100n), [-1n, 2n])).toThrow(/non-negative/);
  });
});

describe('the defects this replaces', () => {
  it('keeps a discount split reconciled where per-line rounding does not', () => {
    // Three lines, a 10.00 discount split by line value.
    const lines = [parseDecimal('33.33'), parseDecimal('33.33'), parseDecimal('33.34')];
    const discount = parseDecimal('10.00');
    const shares = allocate(discount, lines.map((l) => l.minor));

    expect(sum(shares, EGP)).toEqual(discount);

    // The float equivalent, as written elsewhere in this repo.
    const naive = lines.map((l) => Math.round((Number(toDecimalString(l)) / 100) * 10 * 100) / 100);
    expect(naive.reduce((a, b) => a + b, 0)).not.toBe(10);
  });

  it('does not drift when a running total is repeatedly updated', () => {
    // customers.ts does `(parseFloat(totalSpent) + orderAmount).toFixed(2)` on
    // every order, so the error compounds across a customer's lifetime.
    let asMoney = zero(EGP);
    const order = parseDecimal('0.07');

    for (let i = 0; i < 1000; i += 1) {
      asMoney = add(asMoney, order);
    }

    expect(toDecimalString(asMoney)).toBe('70.00');
    expect(asMoney.minor).toBe(7000n);
    // The float path happens to survive here only because of the .toFixed(2)
    // clamp on every step; without it the drift is visible by iteration ~20.
    let unclamped = 0;
    for (let i = 0; i < 1000; i += 1) unclamped += 0.07;
    expect(unclamped).not.toBe(70);
  });
});
